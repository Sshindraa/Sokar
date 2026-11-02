/**
 * Remplissage d'un service creux : choisit les clients à prévenir pour un service donné, réserve un
 * témoin tiré au hasard et produit un brouillon de campagne. N'envoie rien : l'envoi reste celui des
 * campagnes (circuit de création, garde-fous du worker).
 */
import { randomInt } from 'node:crypto';
import type { MarketingCampaign } from '@prisma/client';
import { db } from '../../shared/db/client';
import { ACTIVE_RESERVATION_STATES } from '../../shared/reservations/capacity';
import { COUNTED_RESERVATION_STATES } from '../../shared/reservations/reservation-state';
import { DEFAULT_RESTAURANT_TIMEZONE, zonedTimeToUtc } from '../../shared/timezone/restaurant-time';
import { addDays, parisParts } from '../companion/query-data';
import { isInService, type TonightService } from '../companion/tonight';
import {
  dayBounds,
  forecastEmptyPlaces,
  loadForecastHistory,
  serviceWindow,
  type ForecastRow,
  type ForecastSource,
  type ServiceWindow,
} from './fill-forecast';
import {
  countByTier,
  selectFillAudience,
  tierOf,
  type FillTier,
  type VisitStats,
} from './fill-targeting';
import { CapacityAwareAvailabilityService } from '../floor-plan/availability-capacity-aware.service';
import {
  HOLDOUT_INCLUSION_REASON,
  MAX_CAMPAIGN_AUDIENCE,
  buildAudience,
  createMarketingCampaign,
  estimateCampaignCost,
  remainingDailyEmailBudget,
  renderMarketingTemplate,
  type CampaignAudienceMemberDraft,
  type CampaignChannelCode,
} from './marketing-campaign.service';

export const HOLDOUT_RATE = 0.1;
export const HOLDOUT_MIN_CUSTOMERS = 20;
/** shortcut: pas d'historique de taille de groupe, valeur de repli ; à remplacer par la moyenne réelle. */
const FALLBACK_GROUP_SIZE = 2;
const HISTORY_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Un client déjà attendu dans les 7 jours autour du service est laissé tranquille. */
const NEARBY_DAYS = 7;

export type { ServiceWindow };
export { serviceWindow };

export type ServiceCapacity =
  | { known: false }
  | { known: true; capacity: number; booked: number; free: number };

export type ServiceFillPlan =
  | { status: 'CAPACITY_UNKNOWN' }
  /** Le restaurant n'ouvre pas ce service ce jour-là : aucun créneau n'existe, rien à remplir. */
  | { status: 'SERVICE_CLOSED' }
  /** Plein : le moteur de disponibilité ne propose plus aucun créneau pour 2 couverts. */
  | { status: 'SERVICE_FULL'; capacity: number; booked: number }
  | {
      status: 'PLANNED';
      window: ServiceWindow;
      capacity: number;
      booked: number;
      freePlaces: number;
      /** Places libres − arrivées tardives attendues (prévision). */
      emptyPlaces: number;
      lateArrivals: number;
      forecastSource: ForecastSource;
      groupSize: number;
      /** Nombre de clients retenus, témoin compris. */
      targetSize: number;
      /** Clients après consentement, opposition, fréquence, sans réservation proche du service. */
      candidateCount: number;
      excludedSameDay: number;
      /** Réservation active dans les 7 jours autour du service (hors même jour). */
      excludedNearby: number;
      tiers: Partial<Record<FillTier, number>>;
      /** E-mail et budget du jour épuisé : aucun brouillon possible. */
      budgetExhausted: boolean;
      excludedByReason: Record<string, number>;
      seed: number;
      holdoutCount: number;
      members: CampaignAudienceMemberDraft[];
    };

/** Taille de groupe pour laquelle le service est dit « plein » : celle d'un couple. */
const BOOKABLE_PARTY_SIZE = 2;

/** Texte par défaut : pas de promotion, un lien de réservation et la désinscription obligatoire. */
export const DEFAULT_FILL_BODY =
  'Bonjour {{customer.firstName}}, une table est disponible chez {{restaurant.name}} pour ce service. Réservez ici : {{reservationLink}} STOP : {{unsubscribeUrl}}';
export const DEFAULT_FILL_SUBJECT = 'Une table disponible ce soir-là';

/**
 * Places libres = capacité − couverts réservés (états actifs, comme le moteur de disponibilité).
 * shortcut: capacité = places des tables actives, une seule rotation par service. Elle sous-estime
 * les services à rotation : le remplissage est alors plus prudent, jamais l'inverse.
 */
export async function serviceCapacity(args: {
  restaurantId: string;
  start: Date;
  end: Date;
}): Promise<ServiceCapacity> {
  const tables = await new CapacityAwareAvailabilityService(db).tableRanges(args.restaurantId);
  if (tables.length === 0) return { known: false };
  const capacity = tables.reduce((sum, table) => sum + table.capacity, 0);
  const booked = await db.reservation.aggregate({
    _sum: { partySize: true },
    where: {
      restaurantId: args.restaurantId,
      isTest: false,
      state: { in: [...ACTIVE_RESERVATION_STATES] },
      reservedAt: { gte: args.start, lt: args.end },
    },
  });
  const bookedCovers = booked._sum.partySize ?? 0;
  return { known: true, capacity, booked: bookedCovers, free: capacity - bookedCovers };
}

/**
 * Ce que le moteur de disponibilité (même source que la réservation, rotations comprises) dit du
 * service pour 2 couverts : des créneaux existent-ils (`open`), et l'un d'eux est-il libre (`bookable`) ?
 */
export async function serviceAvailability(args: {
  restaurantId: string;
  start: Date;
  end: Date;
}): Promise<{ open: boolean; bookable: boolean; firstSlotAt: Date | null }> {
  const date = parisParts(args.start).dayKey;
  const availability = await new CapacityAwareAvailabilityService(db).getAvailability({
    restaurantId: args.restaurantId,
    date,
    partySize: BOOKABLE_PARTY_SIZE,
  });
  const inService = availability.slots.flatMap((slot) => {
    const at = zonedTimeToUtc(date, slot.time, DEFAULT_RESTAURANT_TIMEZONE);
    return at >= args.start && at < args.end ? [{ at, available: slot.available }] : [];
  });
  return {
    open: inService.length > 0,
    bookable: inService.some((slot) => slot.available),
    // Premier créneau du service (disponible ou non) : sert à exiger un délai avant le service.
    firstSlotAt: inService.reduce<Date | null>(
      (first, slot) => (first && first <= slot.at ? first : slot.at),
      null,
    ),
  };
}

/**
 * Vrai si le service est plein. Une capacité inconnue (pas de plan de salle) ne bloque rien : elle ne
 * prouve pas que le service est plein.
 */
export async function isTargetServiceFull(args: {
  restaurantId: string;
  start: Date;
  end: Date;
}): Promise<boolean> {
  const tables = await new CapacityAwareAvailabilityService(db).tableRanges(args.restaurantId);
  if (tables.length === 0) return false;
  // Service fermé ou complet : rien à envoyer dans les deux cas.
  return !(await serviceAvailability(args)).bookable;
}

// Générateur reproductible : la même graine redonne exactement le même témoin.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ActiveReservation = { customerId: string | null; reservedAt: Date };

/** Ce qui ne dépend pas du service visé : chargé une fois pour plusieurs dates. */
export type ServiceFillContext = {
  restaurantId: string;
  channel: CampaignChannelCode;
  members: CampaignAudienceMemberDraft[];
  excludedByReason: Record<string, number>;
  groupSize: number;
  honored: Array<{ customerId: string | null; reservedAt: Date }>;
  /** Réservations actives des clients joignables, du début de la journée de Paris à through + 8 j. */
  active: ActiveReservation[];
  history: ForecastRow[];
  /** Reste du budget e-mail du jour ; `null` hors e-mail. */
  budget: number | null;
};

export async function loadServiceFillContext(args: {
  restaurantId: string;
  channel: CampaignChannelCode;
  /** Dernière date visée (jour de Paris, AAAA-MM-JJ). */
  through: string;
  now: Date;
}): Promise<ServiceFillContext> {
  const { restaurantId, channel, now } = args;
  const historySince = new Date(now.getTime() - HISTORY_MS);
  const [groupAverage, audience, history, budget] = await Promise.all([
    db.reservation.aggregate({
      _avg: { partySize: true },
      where: {
        restaurantId,
        isTest: false,
        state: { in: [...COUNTED_RESERVATION_STATES] },
        reservedAt: { gte: historySince, lt: now },
      },
    }),
    buildAudience({ restaurantId, channel, allCustomers: true, now }),
    loadForecastHistory(restaurantId, now),
    channel === 'EMAIL'
      ? db.$transaction((tx) => remainingDailyEmailBudget(tx, now))
      : Promise.resolve(null),
  ]);
  const customerIds = audience.members.map((member) => member.customerId);
  const [honored, active] =
    customerIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.reservation.findMany({
            where: {
              restaurantId,
              isTest: false,
              customerId: { in: customerIds },
              state: 'HONORED',
              reservedAt: { gte: historySince, lt: now },
            },
            select: { customerId: true, reservedAt: true },
          }),
          db.reservation.findMany({
            where: {
              restaurantId,
              isTest: false,
              customerId: { in: customerIds },
              state: { in: [...ACTIVE_RESERVATION_STATES] },
              reservedAt: {
                gte: dayBounds(parisParts(now).dayKey).start,
                lt: dayBounds(addDays(args.through, NEARBY_DAYS + 1)).start,
              },
            },
            select: { customerId: true, reservedAt: true },
          }),
        ]);
  return {
    restaurantId,
    channel,
    members: audience.members,
    excludedByReason: audience.excludedByReason,
    groupSize: groupAverage._avg.partySize ?? FALLBACK_GROUP_SIZE,
    honored,
    active,
    history,
    budget,
  };
}

type OpenService = Extract<ServiceCapacity, { known: true }>;

/** États qui arrêtent le plan avant tout chargement d'audience (capacité inconnue, fermé, plein). */
async function checkServiceState(
  restaurantId: string,
  window: ServiceWindow,
): Promise<
  Exclude<ServiceFillPlan, { status: 'PLANNED' }> | { status: 'OPEN'; capacity: OpenService }
> {
  const capacity = await serviceCapacity({ restaurantId, ...window });
  if (!capacity.known) return { status: 'CAPACITY_UNKNOWN' };
  const availability = await serviceAvailability({ restaurantId, ...window });
  if (!availability.open) return { status: 'SERVICE_CLOSED' };
  if (!availability.bookable) {
    return { status: 'SERVICE_FULL', capacity: capacity.capacity, booked: capacity.booked };
  }
  return { status: 'OPEN', capacity };
}

export async function planFromContext(
  context: ServiceFillContext,
  args: { date: string; service: TonightService; seed?: number; now: Date },
): Promise<ServiceFillPlan> {
  const window = serviceWindow(args.date, args.service);
  const state = await checkServiceState(context.restaurantId, window);
  if (state.status !== 'OPEN') return state;
  return planOpenService(context, args, window, state.capacity);
}

export function planOpenService(
  context: ServiceFillContext,
  args: { date: string; service: TonightService; seed?: number; now: Date },
  window: ServiceWindow,
  capacity: OpenService,
): ServiceFillPlan {
  const { now } = args;

  const { emptyPlaces, lateArrivals, forecastSource } = forecastEmptyPlaces({
    rows: context.history,
    date: args.date,
    service: args.service,
    freePlaces: Math.max(0, capacity.free),
    now,
  });

  const day = dayBounds(args.date);
  const busyToday = new Set<string>();
  const busyNearby = new Set<string>();
  const nearbyFrom = window.start.getTime() - NEARBY_DAYS * DAY_MS;
  const nearbyTo = window.end.getTime() + NEARBY_DAYS * DAY_MS;
  for (const row of context.active) {
    if (!row.customerId) continue;
    if (row.reservedAt >= day.start && row.reservedAt < day.end) busyToday.add(row.customerId);
    else if (row.reservedAt.getTime() >= nearbyFrom && row.reservedAt.getTime() < nearbyTo) {
      busyNearby.add(row.customerId);
    }
  }
  const available = context.members.filter((member) => !busyToday.has(member.customerId));
  // Le même jour passe avant : un client déjà compté en `busyToday` n'est jamais compté deux fois.
  const pool = available.filter((member) => !busyNearby.has(member.customerId));

  // Paliers : visites honorées sur 12 mois, dont celles du même jour de semaine et du même service.
  const weekday = parisParts(window.start).weekday;
  const stats = new Map<string, VisitStats>();
  for (const row of context.honored) {
    if (!row.customerId) continue;
    const entry = stats.get(row.customerId) ?? {
      slotVisits: 0,
      visits: 0,
      lastSlotAt: 0,
      lastAt: 0,
    };
    const at = row.reservedAt.getTime();
    entry.visits++;
    entry.lastAt = Math.max(entry.lastAt, at);
    if (
      parisParts(row.reservedAt).weekday === weekday &&
      isInService(row.reservedAt, args.service)
    ) {
      entry.slotVisits++;
      entry.lastSlotAt = Math.max(entry.lastSlotAt, at);
    }
    stats.set(row.customerId, entry);
  }
  const candidates = pool.map((member) => {
    const visit = stats.get(member.customerId) ?? {
      slotVisits: 0,
      visits: 0,
      lastSlotAt: 0,
      lastAt: 0,
    };
    return { member, stats: visit, tier: tierOf(visit, now) };
  });
  const budgetExhausted = context.budget === 0;
  const selected = selectFillAudience({
    candidates,
    emptyPlaces,
    groupSize: context.groupSize,
    holdoutRate: HOLDOUT_RATE,
    maxSends: Math.min(MAX_CAMPAIGN_AUDIENCE, context.budget ?? MAX_CAMPAIGN_AUDIENCE),
  });

  // Témoin : tirage mélangé avec la graine enregistrée ; les premiers tirés ne reçoivent aucun message.
  const seed = args.seed ?? randomInt(0x7fffffff);
  const random = mulberry32(seed);
  const shuffled = [...selected];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const holdoutCount = Math.round(selected.length * HOLDOUT_RATE);
  const holdoutIds = new Set(shuffled.slice(0, holdoutCount).map((row) => row.member.customerId));

  return {
    status: 'PLANNED',
    window,
    capacity: capacity.capacity,
    booked: capacity.booked,
    freePlaces: capacity.free,
    emptyPlaces,
    lateArrivals,
    forecastSource,
    groupSize: context.groupSize,
    targetSize: selected.length,
    candidateCount: pool.length,
    excludedSameDay: context.members.length - available.length,
    excludedNearby: available.length - pool.length,
    excludedByReason: context.excludedByReason,
    tiers: countByTier(selected.map((row) => row.tier)),
    budgetExhausted,
    seed,
    holdoutCount,
    members: selected.map(({ member, stats: visit }) => ({
      customerId: member.customerId,
      inclusionReason: holdoutIds.has(member.customerId)
        ? HOLDOUT_INCLUSION_REASON
        : member.inclusionReason,
      snapshot: { ...member.snapshot, affinity: visit.slotVisits, holdoutSeed: seed },
    })),
  };
}

export async function planServiceFill(args: {
  restaurantId: string;
  /** Jour de Paris, AAAA-MM-JJ. */
  date: string;
  service: TonightService;
  channel: CampaignChannelCode;
  now?: Date;
  /** Graine du témoin ; absente, tirée au hasard puis enregistrée dans chaque membre. */
  seed?: number;
}): Promise<ServiceFillPlan> {
  const now = args.now ?? new Date();
  const window = serviceWindow(args.date, args.service);
  // Fermé, plein ou capacité inconnue : on s'arrête avant de charger l'audience.
  const state = await checkServiceState(args.restaurantId, window);
  if (state.status !== 'OPEN') return state;
  const context = await loadServiceFillContext({
    restaurantId: args.restaurantId,
    channel: args.channel,
    through: args.date,
    now,
  });
  return planOpenService(
    context,
    { date: args.date, service: args.service, seed: args.seed, now },
    window,
    state.capacity,
  );
}

/** Brouillon de campagne pour un service : passe par le circuit de création existant, n'envoie rien. */
export async function createServiceFillDraft(args: {
  restaurantId: string;
  date: string;
  service: TonightService;
  channel: CampaignChannelCode;
  name: string;
  objective: string;
  subject?: string | null;
  bodyTemplate: string;
  createdBy?: string;
  now?: Date;
  seed?: number;
}): Promise<{ plan: ServiceFillPlan; campaign: MarketingCampaign | null }> {
  const plan = await planServiceFill(args);
  // Sans candidat, un brouillon vide ne servirait à rien : on le refuse.
  if (plan.status !== 'PLANNED' || plan.members.length === 0) return { plan, campaign: null };
  const campaign = await createMarketingCampaign({
    restaurantId: args.restaurantId,
    name: args.name,
    objective: args.objective,
    channel: args.channel,
    members: plan.members,
    targetServiceStart: plan.window.start,
    targetServiceEnd: plan.window.end,
    subject: args.subject,
    bodyTemplate: args.bodyTemplate,
    createdBy: args.createdBy,
  });
  return { plan, campaign };
}

export type FillServiceInput = {
  restaurantId: string;
  /** Jour de Paris, AAAA-MM-JJ. */
  date: string;
  service: TonightService;
  channel: CampaignChannelCode;
};

/** Coût sur le texte par défaut rendu avec le nom du restaurant : un lien de réservation indicatif. */
export function estimateFillCost(args: {
  restaurantName: string | null;
  channel: CampaignChannelCode;
  sends: number;
  now: Date;
}) {
  const body = renderMarketingTemplate(DEFAULT_FILL_BODY, {
    customer: { firstName: 'Client', name: 'Client' },
    restaurant: { name: args.restaurantName ?? 'Votre restaurant' },
    reservationLink: 'https://sokar.tech/book/restaurant',
    unsubscribeUrl: 'https://sokar.tech/marketing/unsubscribe?token=preview',
  });
  return estimateCampaignCost({
    channel: args.channel,
    body,
    audienceCount: args.sends,
    occurredAt: args.now,
  });
}

/**
 * Aperçu chiffré d'un service, sans rien écrire : états, places, candidats, audience, témoin et coût.
 * Aucun nom ni téléphone n'est renvoyé.
 */
export async function previewServiceFill(args: FillServiceInput & { now?: Date }) {
  const plan = await planServiceFill(args);
  const restaurant = await db.restaurant.findUnique({
    where: { id: args.restaurantId },
    select: { name: true },
  });
  const template = {
    subject: args.channel === 'EMAIL' ? DEFAULT_FILL_SUBJECT : null,
    bodyTemplate: DEFAULT_FILL_BODY,
  };
  const base = {
    date: args.date,
    service: args.service,
    channel: args.channel,
    template,
    status: plan.status,
    full: plan.status === 'SERVICE_FULL',
  };
  if (plan.status !== 'PLANNED') {
    return {
      ...base,
      capacityKnown: plan.status !== 'CAPACITY_UNKNOWN',
      capacity: plan.status === 'SERVICE_FULL' ? plan.capacity : null,
      booked: plan.status === 'SERVICE_FULL' ? plan.booked : null,
    };
  }
  const holdoutCount = plan.holdoutCount;
  const sends = plan.members.length - holdoutCount;
  const costEstimate = await estimateFillCost({
    restaurantName: restaurant?.name ?? null,
    channel: args.channel,
    sends,
    now: args.now ?? new Date(),
  });
  return {
    ...base,
    capacityKnown: true,
    capacity: plan.capacity,
    booked: plan.booked,
    freePlaces: plan.freePlaces,
    emptyPlaces: plan.emptyPlaces,
    forecastSource: plan.forecastSource,
    groupSize: plan.groupSize,
    targetSize: plan.targetSize,
    candidateCount: plan.candidateCount,
    excludedSameDay: plan.excludedSameDay,
    excludedNearby: plan.excludedNearby,
    tiers: plan.tiers,
    budgetExhausted: plan.budgetExhausted,
    excludedByReason: plan.excludedByReason,
    audience: plan.members.length,
    holdout: holdoutCount,
    sends,
    costEstimate,
  };
}
