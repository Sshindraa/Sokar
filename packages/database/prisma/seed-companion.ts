/**
 * Données de test du Companion (réservations, appels, clients fictifs) sur le restaurant
 * DEMO_RESTAURANT_ID, celui que requireOrg injecte en dev. Base locale uniquement : le garde-fou
 * refuse NODE_ENV=production et toute base hors localhost, sans option pour forcer.
 *
 * Marquage : chaque exécution supprime d'abord ces seules lignes, puis recrée.
 * - Reservation.createdByClient = 'seed-companion' ;
 * - Call.callSid préfixé 'seed-companion-' ;
 * - Customer.notes = 'seed-companion'.
 * - WaitingListEntry.source = 'seed-companion' ;
 * - ReputationFeedbackRequest.tokenHash préfixé 'seed-companion-' : avis et tâches de récupération
 *   partent par cascade avec leur réservation ;
 * - capacitySpecials.waitingListEnabled = true sur le restaurant, pour que la liste d'attente soit
 *   active dans le banc (les autres réglages sont conservés).
 *
 * Écriture Prisma directe : aucune file BullMQ, aucun SMS, e-mail ni webhook.
 * Usage : pnpm --filter @sokar/database seed:companion (lit apps/api/.env, comme l'API en dev).
 */
import {
  PrismaClient,
  type CallIntent,
  type CallOutcome,
  type Prisma,
  type ReputationFeedbackChannel,
  type ReputationRecoveryTaskStatus,
  type ReservationChannel,
  type ReservationState,
  type WaitingListStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { isLocalDatabaseUrl } from './seed-demo-guard';

const MARKER = 'seed-companion';
const CALL_SID_PREFIX = 'seed-companion-';
const SEED = 20261030;
const PAST_DAYS = 95;
const FUTURE_DAYS = 14;
// Fenêtre « 7 prochains jours » de computeEmptySlots : au-delà, les réservations peuvent rester en attente.
const WINDOW_DAYS = 7;
const CUSTOMER_COUNT = 60;
const CHUNK = 300;
const WAITLIST_PAST: ReadonlyArray<readonly [WaitingListStatus, number]> = [
  ['PROMOTED', 0.45],
  ['EXPIRED', 0.35],
  ['CANCELLED', 0.2],
];
const SCORES: ReadonlyArray<readonly [number, number]> = [
  [5, 0.4],
  [4, 0.25],
  [3, 0.15],
  [2, 0.12],
  [1, 0.08],
];
const FEEDBACK_CHANNELS: ReadonlyArray<readonly [ReputationFeedbackChannel, number]> = [
  ['SMS', 0.6],
  ['EMAIL', 0.4],
];
const RECOVERY_STATUSES: ReadonlyArray<readonly [ReputationRecoveryTaskStatus, number]> = [
  ['OPEN', 0.4],
  ['IN_PROGRESS', 0.15],
  ['RESOLVED', 0.35],
  ['DISMISSED', 0.1],
];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const { DATABASE_URL, DEMO_RESTAURANT_ID, NODE_ENV } = process.env;
if (NODE_ENV === 'production' || !isLocalDatabaseUrl(DATABASE_URL)) {
  console.error('seed-companion refusé : NODE_ENV=production ou DATABASE_URL hors localhost.');
  process.exit(1);
}
if (!DEMO_RESTAURANT_ID) {
  console.error('seed-companion refusé : DEMO_RESTAURANT_ID absent (apps/api/.env).');
  process.exit(1);
}
const restaurantId: string = DEMO_RESTAURANT_ID;

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

// mulberry32 : même graine, mêmes données. Chaque tirage est consommé dans tous les cas, pour que
// la suite ne dépende pas de l'heure d'exécution.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = createRandom(SEED);
const randInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];
function weighted<T>(choices: ReadonlyArray<readonly [T, number]>): T {
  let roll = rnd() * choices.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of choices) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return choices[choices.length - 1][0];
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

const dayKeyOf = (date: Date) => dayFormat.format(date);
const addDays = (dayKey: string, days: number) =>
  new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (dayKey: string) => new Date(`${dayKey}T12:00:00Z`).getUTCDay();
const toMinutes = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

// Instant UTC de l'heure murale (minutes depuis minuit) d'un jour, à Paris : CET ou CEST selon la date.
function parisInstant(dayKey: string, minutes: number): Date {
  const wall = Date.parse(`${dayKey}T00:00:00Z`) + minutes * 60_000;
  const shown = Object.fromEntries(
    clockFormat.formatToParts(new Date(wall)).map(({ type, value }) => [type, Number(value)]),
  );
  const shownMs = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    shown.second,
  );
  return new Date(wall - (shownMs - wall));
}

type Period = { open: string; close: string; lastBooking?: string };
type OpeningHours = Partial<Record<(typeof DAY_KEYS)[number], Period & { slots?: Period[] }>>;

function periodsOn(dayKey: string, hours: OpeningHours): Period[] {
  const day = hours[DAY_KEYS[weekdayOf(dayKey)]];
  if (!day) return [];
  return (day.slots?.length ? day.slots : [day]).filter(
    (period) => period.open && period.close && toMinutes(period.close) > toMinutes(period.open),
  );
}

// Créneau de 15 minutes, de l'ouverture à la dernière réservation acceptée.
function bookingMinute(period: Period): number {
  const open = toMinutes(period.open);
  const last = toMinutes(period.lastBooking ?? period.close);
  return open + 15 * randInt(0, Math.floor((last - open) / 15));
}

// Environ un appel sur cinq tombe hors des heures d'ouverture. Jamais dans le futur.
// Instant d'un appel, ancré sur minuit du jour : indépendant de l'heure à laquelle le seed tourne.
function callInstant(dayKey: string, periods: Period[]): Date {
  let minute: number;
  if (periods.length > 0 && rnd() < 0.8) {
    const period = pick(periods);
    const open = toMinutes(period.open);
    minute = open + randInt(0, toMinutes(period.close) - open - 1);
  } else {
    minute = pick([randInt(0, 659), randInt(1380, 1439)]);
  }
  return parisInstant(dayKey, minute);
}

// Vendredi et samedi pleins, jeudi moyen, le reste plus calme.
function dailyRange(dayKey: string): [number, number] {
  const weekday = weekdayOf(dayKey);
  if (weekday === 5 || weekday === 6) return [20, 25];
  if (weekday === 4) return [10, 16];
  return [5, 12];
}

const FIRST_NAMES = [
  'Camille',
  'Léa',
  'Hugo',
  'Manon',
  'Louis',
  'Chloé',
  'Nathan',
  'Inès',
  'Théo',
  'Sarah',
  'Julien',
  'Clara',
  'Antoine',
  'Emma',
  'Mathis',
  'Lucie',
  'Pierre',
  'Alice',
  'Maxime',
  'Zoé',
  'Vincent',
  'Julie',
  'Romain',
  'Élodie',
  'Adrien',
  'Margaux',
  'Quentin',
  'Océane',
  'Baptiste',
  'Noémie',
];
const LAST_NAMES = [
  'Martin',
  'Bernard',
  'Dubois',
  'Thomas',
  'Robert',
  'Richard',
  'Petit',
  'Durand',
  'Leroy',
  'Moreau',
  'Girard',
  'Roux',
  'Fournier',
  'Lambert',
  'Fontaine',
  'Mercier',
  'Blanc',
  'Garnier',
  'Faure',
  'Rousseau',
];
const asciiSlug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const CHANNELS: ReadonlyArray<readonly [ReservationChannel, number]> = [
  ['PHONE', 35],
  ['WEB', 35],
  ['MCP', 15],
  ['ADMIN', 15],
];
const PARTY_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1, 10],
  [2, 40],
  [3, 15],
  [4, 20],
  [5, 6],
  [6, 5],
  [7, 2],
  [8, 2],
];
const PAST_STATES: ReadonlyArray<readonly [ReservationState, number]> = [
  ['HONORED', 88],
  ['CANCELLED', 8],
  ['NO_SHOW', 4],
];
const RESERVED_CALL: { intent: CallIntent; outcome: CallOutcome } = {
  intent: 'RESERVATION',
  outcome: 'RESERVED',
};
const OTHER_CALLS: ReadonlyArray<readonly [{ intent: CallIntent; outcome: CallOutcome }, number]> =
  [
    [{ intent: 'HOURS', outcome: 'INFO' }, 45],
    [{ intent: 'OTHER', outcome: 'MESSAGE' }, 30],
    [{ intent: 'CANCEL', outcome: 'MESSAGE' }, 19],
    [{ intent: 'RESERVATION', outcome: 'NO_ACTION' }, 6],
  ];

const chunks = <T>(rows: T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, index) =>
    rows.slice(index * CHUNK, (index + 1) * CHUNK),
  );

async function main() {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, openingHours: true },
  });
  if (!restaurant) {
    console.error(
      `seed-companion refusé : restaurant ${restaurantId} introuvable dans cette base.`,
    );
    process.exit(1);
  }
  const hours = (restaurant.openingHours ?? {}) as OpeningHours;
  const exposure = await prisma.restaurantExposureSettings.findUnique({
    where: { restaurantId },
    select: { capacitySpecials: true },
  });
  const now = new Date();
  const today = dayKeyOf(now);
  // Jour faible des 7 prochains jours : un seul, avec une ou deux réservations.
  const weakOffset = [2, 3, 4, 5].find(
    (offset) => periodsOn(addDays(today, offset), hours).length > 0,
  );

  const customers = Array.from({ length: CUSTOMER_COUNT }, (_, index) => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    return {
      id: randomUUID(),
      name: `${first} ${last}`,
      // Plage fictive ARCEP : +33 6 39 98 xx xx.
      phone: `+3363998${1000 + index}`,
      emailNormalized: `${asciiSlug(first)}.${asciiSlug(last)}${index}@example.com`,
    };
  });

  const reservations: Prisma.ReservationCreateManyInput[] = [];
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
    const day = addDays(today, offset);
    const periods = periodsOn(day, hours);
    if (periods.length === 0) continue;
    const count = offset === weakOffset ? randInt(1, 2) : randInt(...dailyRange(day));

    for (let index = 0; index < count; index++) {
      const period = pick(periods);
      const reservedAt = parisInstant(day, bookingMinute(period));
      const customer = pick(customers);
      const partySize = weighted(PARTY_SIZES);
      const channel = weighted(CHANNELS);
      const pending = rnd() < 0.1;
      const past = weighted(PAST_STATES);
      const state: ReservationState =
        reservedAt > now ? (offset >= WINDOW_DAYS && pending ? 'PENDING' : 'CONFIRMED') : past;

      // Pris de 0 à 21 jours avant le service, sans dépasser aujourd'hui ni la fenêtre.
      let createdDay = addDays(day, -Math.min(randInt(0, 21), offset + PAST_DAYS));
      if (createdDay > today) createdDay = addDays(today, -randInt(0, 21));
      const createdAt = new Date(
        Math.min(
          callInstant(createdDay, periodsOn(createdDay, hours)).getTime(),
          reservedAt.getTime() - 60 * 60_000,
        ),
      );

      reservations.push({
        id: randomUUID(),
        restaurantId,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.emailNormalized,
        reservedAt,
        startsAt: reservedAt,
        endsAt: new Date(reservedAt.getTime() + 90 * 60_000),
        partySize,
        estimatedRevenue: partySize * randInt(30, 55),
        channel,
        state,
        // Projection historique : HONORED garde CONFIRMED, son dernier état projeté.
        status: state === 'CANCELLED' || state === 'NO_SHOW' ? state : 'CONFIRMED',
        createdAt,
        createdByClient: MARKER,
      });
    }
  }

  // Chaque réservation par téléphone naît d'un appel RESERVED, au moment de sa création. Au-delà de
  // 15 par jour, la réservation passe en WEB : le volume d'appels reste dans la plage prévue.
  const calls: Prisma.CallCreateManyInput[] = [];
  for (let offset = -PAST_DAYS; offset <= 0; offset++) {
    const day = addDays(today, offset);
    const phoneBookings = reservations.filter(
      (reservation) =>
        reservation.channel === 'PHONE' && dayKeyOf(reservation.createdAt as Date) === day,
    );
    phoneBookings.slice(15).forEach((reservation) => {
      reservation.channel = 'WEB';
    });
    const booked = phoneBookings.slice(0, 15);
    const periods = periodsOn(day, hours);
    const volume = Math.max(randInt(3, 15), booked.length);

    for (let index = 0; index < volume; index++) {
      const reservation = booked[index];
      const id = randomUUID();
      if (reservation) reservation.callId = id;
      const outcome = reservation ? RESERVED_CALL : weighted(OTHER_CALLS);
      calls.push({
        id,
        restaurantId,
        callSid: `${CALL_SID_PREFIX}${day}-${index}`,
        callerPhone: reservation?.customerPhone ?? pick(customers).phone,
        durationSec: randInt(20, 240),
        intent: outcome.intent,
        outcome: outcome.outcome,
        carrier: 'telnyx',
        createdAt: reservation ? (reservation.createdAt as Date) : callInstant(day, periods),
      });
    }
  }

  // Liste d'attente : demandes sur des créneaux à venir (en attente) ou passés (obtenues, expirées, annulées).
  const waitlist: Prisma.WaitingListEntryCreateManyInput[] = [];
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
    const day = addDays(today, offset);
    const periods = periodsOn(day, hours);
    if (periods.length === 0) continue;
    for (let index = 0; index < randInt(0, 3); index++) {
      const period = pick(periods);
      const slotStart = parisInstant(day, bookingMinute(period));
      const customer = pick(customers);
      const [firstName, ...lastNames] = customer.name.split(' ');
      // Tirage fait dans tous les cas : la suite du seed ne dépend pas de l'heure.
      const pastStatus = weighted(WAITLIST_PAST);
      const status: WaitingListStatus = slotStart > now ? 'PENDING' : pastStatus;
      waitlist.push({
        id: randomUUID(),
        restaurantId,
        partySize: weighted(PARTY_SIZES),
        customerFirstName: firstName,
        customerLastName: lastNames.join(' ') || null,
        customerPhone: customer.phone,
        customerPhoneNormalized: customer.phone,
        customerEmail: customer.emailNormalized,
        slotStart,
        slotEnd: new Date(slotStart.getTime() + 90 * 60_000),
        status,
        position: index + 1,
        actionTokenHash: `${MARKER}-${randomUUID()}`,
        expiresAt: slotStart,
        promotedAt: status === 'PROMOTED' ? new Date(slotStart.getTime() - 30 * 60_000) : null,
        cancelledAt: status === 'CANCELLED' ? new Date(slotStart.getTime() - 2 * 3_600_000) : null,
        source: MARKER,
        createdAt: new Date(slotStart.getTime() - randInt(1, 21) * 86_400_000),
      });
    }
  }

  // Avis : une partie des réservations honorées passées reçoit une demande, un avis, et une tâche de
  // récupération si la note est faible.
  const requests: Prisma.ReputationFeedbackRequestCreateManyInput[] = [];
  const feedbacks: Prisma.ReputationFeedbackCreateManyInput[] = [];
  const recoveries: Prisma.ReputationRecoveryTaskCreateManyInput[] = [];
  for (const reservation of reservations) {
    const reservedAt = reservation.reservedAt as Date;
    const sampled = rnd() <= 0.35;
    if (!sampled || reservation.state !== 'HONORED' || reservedAt > now) continue;
    const requestedAt = new Date(reservedAt.getTime() + 86_400_000);
    const submittedAt = new Date(requestedAt.getTime() + randInt(0, 2) * 86_400_000);
    if (submittedAt > now) continue;
    const requestId = randomUUID();
    const customerId = reservation.customerId as string;
    requests.push({
      id: requestId,
      restaurantId,
      reservationId: reservation.id as string,
      customerId,
      channel: weighted(FEEDBACK_CHANNELS),
      status: 'SUBMITTED',
      tokenHash: `${MARKER}-${randomUUID()}`,
      expiresAt: new Date(requestedAt.getTime() + 7 * 86_400_000),
      requestedAt,
      sentAt: requestedAt,
      submittedAt,
    });
    const score = weighted(SCORES);
    const feedbackId = randomUUID();
    feedbacks.push({
      id: feedbackId,
      requestId,
      restaurantId,
      reservationId: reservation.id as string,
      customerId,
      score,
      comment: null,
      submittedAt,
    });
    if (score <= 2) {
      const status = weighted(RECOVERY_STATUSES);
      recoveries.push({
        feedbackId,
        restaurantId,
        reservationId: reservation.id as string,
        customerId,
        status,
        priority: score === 1 ? 'HIGH' : 'NORMAL',
        resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? submittedAt : null,
      });
    }
  }

  await prisma.$transaction([
    prisma.reservation.deleteMany({ where: { restaurantId, createdByClient: MARKER } }),
    prisma.call.deleteMany({ where: { restaurantId, callSid: { startsWith: CALL_SID_PREFIX } } }),
    prisma.customer.deleteMany({ where: { restaurantId, notes: MARKER } }),
    prisma.waitingListEntry.deleteMany({ where: { restaurantId, source: MARKER } }),
    prisma.reputationFeedbackRequest.deleteMany({
      where: { restaurantId, tokenHash: { startsWith: MARKER } },
    }),
    ...chunks(customers.map((customer) => ({ ...customer, restaurantId, notes: MARKER }))).map(
      (data) => prisma.customer.createMany({ data }),
    ),
    ...chunks(calls).map((data) => prisma.call.createMany({ data })),
    ...chunks(reservations).map((data) => prisma.reservation.createMany({ data })),
    ...chunks(waitlist).map((data) => prisma.waitingListEntry.createMany({ data })),
    ...chunks(requests).map((data) => prisma.reputationFeedbackRequest.createMany({ data })),
    ...chunks(feedbacks).map((data) => prisma.reputationFeedback.createMany({ data })),
    ...chunks(recoveries).map((data) => prisma.reputationRecoveryTask.createMany({ data })),
    ...(exposure
      ? [
          prisma.restaurantExposureSettings.update({
            where: { restaurantId },
            data: {
              capacitySpecials: {
                ...((exposure.capacitySpecials ?? {}) as object),
                waitingListEnabled: true,
              },
            },
          }),
        ]
      : []),
  ]);

  // eslint-disable-next-line no-console -- bilan de la graine, lu dans le terminal
  console.log(
    `Companion pour ${restaurant.name} : ${reservations.length} réservations, ${calls.length} appels, ${waitlist.length} demandes en liste d'attente, ${feedbacks.length} avis (${recoveries.length} tâches de récupération), ${customers.length} clients créés.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
