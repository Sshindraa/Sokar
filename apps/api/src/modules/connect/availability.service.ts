/**
 * Sokar Connect — Availability service.
 *
 * Calcule les slots disponibles pour un restaurant à une date donnée.
 *
 * Règles :
 * 1. Les slots sont générés depuis `openingHours` (JSON du resto) par pas
 *    de 30 minutes entre open et close.
 * 2. Un slot est indisponible si :
 *    - il y a un hold actif (status=ACTIVE, expiresAt>now) sur ce créneau
 *    - il y a une reservation confirmée non annulée sur ce créneau
 *    - le lead time minimum (minLeadTimeMinutes) n'est pas respecté
 * 3. Le respect de `maxPartySize` est implicite : on compte les holds + résas
 *    actives du slot, et on compare à la capacité (estimée à 1 par défaut —
 *    l'admin fixe une vraie capacité via capacitySpecials, hors scope P0).
 *
 * Note P0 : capacity = 1 par service (1 résa = slot pris). Le Capacity-aware
 * arrival est en P2 (cf. spec v1.1 §11.3 "P2 Capacity").
 */

import { PrismaClient } from '@prisma/client';
import { normalizeOpeningHours } from '@sokar/shared';
import type { AvailabilityDto, AvailabilitySlot } from './connect.types';
import { MINUTES_TO_MS, HOURS_TO_MINUTES, HOURS_PER_DAY } from '../../shared/constants/time.js';

const SLOT_MINUTES = 30;

export class ConnectAvailabilityService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Retourne les slots pour (restaurantId, date, partySize).
   * Renvoie [] si le resto n'est pas publié.
   */
  async getAvailability(args: {
    restaurantId: string;
    date: string; // YYYY-MM-DD
    partySize: number;
  }): Promise<AvailabilityDto> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: args.restaurantId },
      include: { exposureSettings: true },
    });

    if (!restaurant || !restaurant.exposureSettings?.connectPublished) {
      return {
        restaurantId: args.restaurantId,
        date: args.date,
        partySize: args.partySize,
        slots: [],
      };
    }

    // Récupérer exposure pour maxPartySize + minLeadTimeMinutes
    const maxPartySize = restaurant.exposureSettings.maxPartySize ?? 12;
    if (args.partySize > maxPartySize) {
      // Pas de slots si party size dépasse la limite du resto
      return {
        restaurantId: args.restaurantId,
        date: args.date,
        partySize: args.partySize,
        slots: [],
      };
    }
    const minLeadTimeMinutes = restaurant.exposureSettings.minLeadTimeMinutes ?? 30;

    // Calculer le jour de la semaine (0 = dimanche, 6 = samedi)
    const dayOfWeek = computeDayOfWeek(args.date);

    // Normaliser openingHours pour ce jour
    const openingHours = normalizeOpeningHours(restaurant.openingHours);
    const dayHours = openingHours.find((d) => d.dayIndex === dayOfWeek);

    if (!dayHours) {
      return {
        restaurantId: args.restaurantId,
        date: args.date,
        partySize: args.partySize,
        slots: [],
      };
    }

    // Générer les slots entre open et close par pas de 30min
    const allSlots = generateSlots(dayHours.open, dayHours.close, SLOT_MINUTES);
    if (allSlots.length === 0) {
      return {
        restaurantId: args.restaurantId,
        date: args.date,
        partySize: args.partySize,
        slots: [],
      };
    }

    // Fenêtre [start, end] du jour LOCAL du restaurant pour filtrer holds/résas.
    // On convertit minuit et 23:59 en UTC via la timezone du resto.
    const timeZone = restaurant.timezone ?? 'Europe/Paris';
    const dayStart = zonedTimeToUtc(args.date, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(args.date, '23:59', timeZone);

    // 1. Holds actifs
    const activeHolds = await this.prisma.agenticHold.findMany({
      where: {
        restaurantId: args.restaurantId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        slotStart: { gte: dayStart, lte: dayEnd },
      },
      select: { slotStart: true },
    });
    const heldSlotStarts = new Set(activeHolds.map((h) => h.slotStart.toISOString()));

    // 2. Réservations actives (state=CONFIRMED ou PENDING, non CANCELLED)
    // state est le champ canonique (default CONFIRMED via migration backfill).
    const confirmedReservations = await this.prisma.reservation.findMany({
      where: {
        restaurantId: args.restaurantId,
        state: { in: ['CONFIRMED', 'PENDING'] },
        startsAt: { gte: dayStart, lte: dayEnd },
      },
      select: { startsAt: true },
    });
    const reservedStarts = new Set(confirmedReservations.map((r) => r.startsAt!.toISOString()));

    // 3. Calculer le moment de la requête pour lead time
    const now = new Date();
    const minLeadTimeMs = minLeadTimeMinutes * MINUTES_TO_MS;
    const minBookingTime = new Date(now.getTime() + minLeadTimeMs);

    // Construire les slots avec leur état (conversion local → UTC via timezone)
    const slots: AvailabilitySlot[] = allSlots.map((time) => {
      const slotStart = zonedTimeToUtc(args.date, time, timeZone);
      const isHeld = heldSlotStarts.has(slotStart.toISOString());
      const isReserved = reservedStarts.has(slotStart.toISOString());
      const isBeforeLeadTime = slotStart < minBookingTime;
      return {
        time,
        available: !isHeld && !isReserved && !isBeforeLeadTime,
      };
    });

    return {
      restaurantId: args.restaurantId,
      date: args.date,
      partySize: args.partySize,
      slots,
    };
  }
}

/** Calcule le dayOfWeek 0-6 (0=dimanche) à partir d'une date YYYY-MM-DD */
function computeDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Date en UTC pour cohérence avec le seed
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDay();
}

/** Génère les créneaux entre open et close par pas de 30min (format HH:mm) */
function generateSlots(open: string, close: string, stepMinutes: number): string[] {
  const slots: string[] = [];
  const [openH, openM] = open.split(':').map(Number);
  const [closeH, closeM] = close.split(':').map(Number);
  let cur = openH * HOURS_TO_MINUTES + openM;
  const end = closeH * HOURS_TO_MINUTES + closeM;
  while (cur + stepMinutes <= end) {
    const h = Math.floor(cur / HOURS_TO_MINUTES);
    const m = cur % HOURS_TO_MINUTES;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    cur += stepMinutes;
  }
  return slots;
}

// Export util pour les tests
export const __test_only__ = {
  computeDayOfWeek,
  normalizeOpeningHours,
  generateSlots,
  zonedTimeToUtc,
};

/**
 * Convertit une date locale (ex: "2026-07-02" + "19:00") dans une timezone
 * donnée en Date UTC.
 *
 * Ex: ("2026-07-02", "19:00", "Europe/Paris") → 17:00 UTC (été, UTC+2)
 *     ("2026-01-02", "19:00", "Europe/Paris") → 18:00 UTC (hiver, UTC+1)
 *
 * Utilise Intl.DateTimeFormat pour calculer l'offset DST au moment donné.
 */
function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  // Date "naive" : comme si l'heure locale était UTC
  const naive = new Date(
    `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
  );

  // Formater cette date dans la timezone cible pour voir l'heure locale réelle
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(naive);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const localYear = parseInt(get('year'), 10);
  const localMonth = parseInt(get('month'), 10) - 1; // 0-indexed
  const localDay = parseInt(get('day'), 10);
  const localHour = parseInt(get('hour'), 10) % 24; // Intl peut retourner "24" pour minuit
  const localMinute = parseInt(get('minute'), 10);

  // Construire la date UTC qui correspond à cette heure locale affichée
  const localAsUtc = Date.UTC(localYear, localMonth, localDay, localHour, localMinute, 0);
  // L'offset = différence entre l'heure locale affichée et l'heure naive
  const offsetMs = localAsUtc - naive.getTime();

  // Ajuster : si la timezone est en avance (ex: +2h), on retire 2h de la naive
  return new Date(naive.getTime() - offsetMs);
}
