/**
 * Canal A — Availability service.
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
import { computeAttributeConfidence } from '../agentic-reservations/core/confidence.service';
import type { AvailabilityDto, AvailabilitySlot, OpeningHoursSpec } from './canal-a.types';
import { logger } from '../../shared/logger/pino';

const SLOT_MINUTES = 30;
const DEFAULT_CAPACITY = 1;

export class CanalAAvailabilityService {
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

    if (!restaurant || !restaurant.exposureSettings?.canalAPublished) {
      return { restaurantId: args.restaurantId, date: args.date, partySize: args.partySize, slots: [] };
    }

    // Récupérer exposure pour maxPartySize + minLeadTimeMinutes
    const maxPartySize = restaurant.exposureSettings.maxPartySize ?? 12;
    if (args.partySize > maxPartySize) {
      // Pas de slots si party size dépasse la limite du resto
      return { restaurantId: args.restaurantId, date: args.date, partySize: args.partySize, slots: [] };
    }
    const minLeadTimeMinutes = restaurant.exposureSettings.minLeadTimeMinutes ?? 30;

    // Calculer le jour de la semaine (0 = dimanche, 6 = samedi)
    const dayOfWeek = computeDayOfWeek(args.date);

    // Normaliser openingHours pour ce jour
    const openingHours = normalizeOpeningHours(restaurant.openingHours);
    const dayHours = openingHours.find((d) => d.dayIndex === dayOfWeek);

    if (!dayHours) {
      return { restaurantId: args.restaurantId, date: args.date, partySize: args.partySize, slots: [] };
    }

    // Générer les slots entre open et close par pas de 30min
    const allSlots = generateSlots(dayHours.open, dayHours.close, SLOT_MINUTES);
    if (allSlots.length === 0) {
      return { restaurantId: args.restaurantId, date: args.date, partySize: args.partySize, slots: [] };
    }

    // Fenêtre [start, end] du jour pour filtrer holds/résas
    const dayStart = new Date(`${args.date}T00:00:00.000Z`);
    const dayEnd = new Date(`${args.date}T23:59:59.999Z`);

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

    // 2. Réservations actives (state=CONFIRMED + channel=WEB, ou state=PENDING)
    const confirmedReservations = await this.prisma.reservation.findMany({
      where: {
        restaurantId: args.restaurantId,
        OR: [
          { status: 'CONFIRMED' },
          { state: 'CONFIRMED' },
          { state: 'PENDING' },
        ],
        startsAt: { gte: dayStart, lte: dayEnd },
      },
      select: { startsAt: true },
    });
    const reservedStarts = new Set(confirmedReservations.map((r) => r.startsAt!.toISOString()));

    // 3. Calculer le moment de la requête pour lead time
    const now = new Date();
    const minLeadTimeMs = minLeadTimeMinutes * 60 * 1000;
    const minBookingTime = new Date(now.getTime() + minLeadTimeMs);

    // Construire les slots avec leur état
    const slots: AvailabilitySlot[] = allSlots.map((time) => {
      const slotStart = new Date(`${args.date}T${time}:00.000Z`);
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

type NormalizedHours = { dayIndex: number; open: string; close: string }[];

/** Normalise openingHours (multi-formats supportés) en dayIndex 0-6 */
function normalizeOpeningHours(raw: unknown): NormalizedHours {
  if (!raw || typeof raw !== 'object') return [];

  const dayToIndex: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };

  if (Array.isArray(raw)) {
    return raw
      .map((entry: { dayOfWeek?: string; opens?: string; closes?: string }) => {
        const dow = entry.dayOfWeek?.toLowerCase();
        if (!dow) return null;
        const dayIndex = dayToIndex[dow];
        if (dayIndex == null || !entry.opens || !entry.closes) return null;
        return { dayIndex, open: entry.opens, close: entry.closes };
      })
      .filter((x): x is NormalizedHours[0] => x !== null)
      .sort((a, b) => a.dayIndex - b.dayIndex);
  }

  return Object.entries(raw as Record<string, unknown>)
    .map(([key, val]) => {
      const dayIndex = dayToIndex[key.toLowerCase()];
      if (dayIndex == null) return null;
      if (!val || typeof val !== 'object') return null;
      const v = val as { open?: string; close?: string; opens?: string; closes?: string };
      const open = v.open ?? v.opens;
      const close = v.close ?? v.closes;
      if (!open || !close) return null;
      return { dayIndex, open, close };
    })
    .filter((x): x is NormalizedHours[0] => x !== null)
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

/** Génère les créneaux entre open et close par pas de 30min (format HH:mm) */
function generateSlots(open: string, close: string, stepMinutes: number): string[] {
  const slots: string[] = [];
  const [openH, openM] = open.split(':').map(Number);
  const [closeH, closeM] = close.split(':').map(Number);
  let cur = openH * 60 + openM;
  const end = closeH * 60 + closeM;
  while (cur + stepMinutes <= end) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    cur += stepMinutes;
  }
  return slots;
}

// Export util pour les tests
export const __test_only__ = { computeDayOfWeek, normalizeOpeningHours, generateSlots };
