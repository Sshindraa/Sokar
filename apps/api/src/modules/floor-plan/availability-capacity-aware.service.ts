/**
 * CapacityAwareAvailabilityService — moteur de disponibilité basé sur les
 * tables physiques.
 *
 * Remplace les moteurs capacité-naïfs existants (reservation.service.ts,
 * connect/availability.service.ts, agentic-reservations/core/availability.service.ts)
 * en phase 2.
 *
 * Contrat de surface inchangé : { restaurantId, date, partySize, slots }.
 */

import { PrismaClient } from '@prisma/client';
import type { AvailabilityDto, AvailabilitySlot } from './floor-plan.types';
import { resolveServiceDurationMinutes } from './floor-plan.types';
import { TableAllocationService } from './table-allocation.service';

const SLOT_MINUTES = 30;

export class CapacityAwareAvailabilityService {
  private readonly allocation: TableAllocationService;

  constructor(private readonly prisma: PrismaClient) {
    this.allocation = new TableAllocationService(prisma);
  }

  /**
   * Retourne les créneaux disponibles pour (restaurantId, date, partySize).
   * Un créneau est disponible si au moins une table active peut accueillir le
   * groupe sur la durée du service.
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

    if (!restaurant) {
      return emptyAvailability(args);
    }

    const timeZone = restaurant.timezone ?? 'Europe/Paris';
    const serviceDurationMinutes = resolveServiceDurationMinutes(
      restaurant.exposureSettings?.capacitySpecials,
    );

    const dayOfWeek = computeDayOfWeek(args.date);
    const openingHours = normalizeOpeningHours(restaurant.openingHours);
    const dayHours = openingHours.find((d) => d.dayIndex === dayOfWeek);

    if (!dayHours) {
      return emptyAvailability(args);
    }

    const allSlots = generateSlots(dayHours.open, dayHours.close, SLOT_MINUTES);
    if (allSlots.length === 0) {
      return emptyAvailability(args);
    }

    // Récupérer toutes les réservations bloquantes et holds actifs du jour
    // pour les tester localement (optimisation P1).
    const dayStart = zonedTimeToUtc(args.date, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(args.date, '23:59:59.999', timeZone);

    const floorPlan = await this.prisma.floorPlan.findUnique({
      where: { restaurantId: args.restaurantId },
      select: { id: true },
    });
    if (!floorPlan) {
      return emptyAvailability(args);
    }

    const [reservations, holds, tables] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          restaurantId: args.restaurantId,
          state: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
          tableId: { not: null },
          startsAt: { gte: dayStart, lt: dayEnd },
        },
        select: { tableId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.agenticHold.findMany({
        where: {
          restaurantId: args.restaurantId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          tableId: { not: null },
          slotStart: { gte: dayStart, lt: dayEnd },
        },
        select: { tableId: true, slotStart: true, slotEnd: true },
      }),
      this.prisma.table.findMany({
        where: {
          floorPlanId: floorPlan.id,
          isActive: true,
          capacity: { gte: args.partySize },
        },
        select: { id: true, capacity: true, minCapacity: true },
      }),
    ]);

    const busyByTable = new Map<string, Array<{ start: Date; end: Date }>>();
    for (const r of reservations) {
      if (!r.tableId || !r.startsAt || !r.endsAt) continue;
      const list = busyByTable.get(r.tableId) ?? [];
      list.push({ start: r.startsAt, end: r.endsAt });
      busyByTable.set(r.tableId, list);
    }
    for (const h of holds) {
      if (!h.tableId) continue;
      const list = busyByTable.get(h.tableId) ?? [];
      list.push({ start: h.slotStart, end: h.slotEnd });
      busyByTable.set(h.tableId, list);
    }

    const slots: AvailabilitySlot[] = allSlots.map((time) => {
      const slotStart = zonedTimeToUtc(args.date, time, timeZone);
      const slotEnd = new Date(slotStart.getTime() + serviceDurationMinutes * 60_000);

      const hasAvailableTable = tables.some((table) => {
        if (table.minCapacity > args.partySize) return false;
        const busy = busyByTable.get(table.id) ?? [];
        return !busy.some((b) => overlaps(b.start, b.end, slotStart, slotEnd));
      });

      return { time, available: hasAvailableTable };
    });

    return {
      restaurantId: args.restaurantId,
      date: args.date,
      partySize: args.partySize,
      slots,
    };
  }
}

function emptyAvailability(args: {
  restaurantId: string;
  date: string;
  partySize: number;
}): AvailabilityDto {
  return {
    restaurantId: args.restaurantId,
    date: args.date,
    partySize: args.partySize,
    slots: [],
  };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function computeDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

type NormalizedHours = { dayIndex: number; open: string; close: string }[];

function normalizeOpeningHours(raw: unknown): NormalizedHours {
  if (!raw || typeof raw !== 'object') return [];

  const dayToIndex: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
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

/**
 * Convertit une date locale (ex: "2026-07-02" + "19:00") dans une timezone
 * donnée en Date UTC.
 *
 * Ex: ("2026-07-02", "19:00", "Europe/Paris") → 17:00 UTC (été, UTC+2)
 *     ("2026-01-02", "19:00", "Europe/Paris") → 18:00 UTC (hiver, UTC+1)
 *
 * Utilise Intl.DateTimeFormat pour calculer l'offset DST au moment donné.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
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
