/**
 * CapacityAwareAvailabilityService — moteur de disponibilité basé sur les
 * tables physiques.
 *
 * Remplace les moteurs capacité-naïfs existants (reservation.service.ts,
 * agentic-reservations/core/availability.service.ts). Connect utilise
 * désormais directement ce service.
 *
 * Contrat de surface inchangé : { restaurantId, date, partySize, slots }.
 */

import { PrismaClient } from '@prisma/client';
import { normalizeOpeningHours } from '@sokar/shared';
import type { AvailabilityDto, AvailabilitySlot } from './floor-plan.types';
import { resolveServiceDurationMinutes } from './floor-plan.types';
import { TableAllocationService } from './table-allocation.service';
import { HOURS_TO_MINUTES } from '../../shared/constants/time.js';
import { redisCache } from '../../shared/redis/client';
import { logger } from '../../shared/logger/pino';
import { ACTIVE_RESERVATION_STATES, intervalsOverlap } from '../../shared/reservations/capacity.js';
import {
  DEFAULT_RESTAURANT_TIMEZONE,
  zonedTimeToUtc,
} from '../../shared/timezone/restaurant-time.js';

// Compatibilité pour les callers internes existants. L'implémentation est
// désormais centralisée dans shared/timezone.
export {
  DEFAULT_RESTAURANT_TIMEZONE,
  zonedTimeToUtc,
} from '../../shared/timezone/restaurant-time.js';

const SLOT_MINUTES = 30;
const AVAILABILITY_CACHE_TTL_SECONDS = 30;
const AVAILABILITY_VERSION_TTL_SECONDS = 120;
const CACHE_KEY_PREFIX = 'availability:v:';

export class CapacityAwareAvailabilityService {
  private readonly allocation: TableAllocationService;

  constructor(private readonly prisma: PrismaClient) {
    this.allocation = new TableAllocationService(prisma);
  }

  private cacheKey(
    args: { restaurantId: string; date: string; partySize: number; preferredSectionId?: string },
    version: number,
  ): string {
    const sectionSuffix = args.preferredSectionId ? `:s:${args.preferredSectionId}` : '';
    return `${CACHE_KEY_PREFIX}${args.restaurantId}:${args.date}:${args.partySize}${sectionSuffix}:${version}`;
  }

  private versionKey(restaurantId: string): string {
    return `${CACHE_KEY_PREFIX}${restaurantId}`;
  }

  private async getVersion(restaurantId: string): Promise<number> {
    try {
      const raw = await redisCache.get(this.versionKey(restaurantId));
      return Number(raw ?? 0);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, restaurantId },
        'availability cache version read failed',
      );
      return 0;
    }
  }

  static async invalidateAvailability(restaurantId: string): Promise<void> {
    const key = `${CACHE_KEY_PREFIX}${restaurantId}`;
    try {
      await redisCache.incr(key);
      await redisCache.expire(key, AVAILABILITY_VERSION_TTL_SECONDS);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, restaurantId },
        'availability cache invalidation failed',
      );
    }
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
    preferredSectionId?: string;
  }): Promise<AvailabilityDto> {
    let version = 0;
    try {
      version = await this.getVersion(args.restaurantId);
      const cached = await redisCache.get(this.cacheKey(args, version));
      if (cached) {
        return JSON.parse(cached) as AvailabilityDto;
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, args },
        'availability cache read failed',
      );
    }

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: args.restaurantId },
      include: { exposureSettings: true },
    });

    if (!restaurant) {
      return emptyAvailability(args);
    }

    const timeZone = restaurant.timezone ?? DEFAULT_RESTAURANT_TIMEZONE;
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

    const [reservations, holds, tables] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          restaurantId: args.restaurantId,
          state: { in: [...ACTIVE_RESERVATION_STATES] },
          OR: [
            { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
            // Legacy rows may have startsAt but no endsAt; their duration is
            // reconstructed below from the restaurant service duration.
            { startsAt: { gte: dayStart, lt: dayEnd }, endsAt: null },
            { startsAt: null, reservedAt: { gte: dayStart, lt: dayEnd } },
          ],
        },
        select: { tableId: true, startsAt: true, endsAt: true, reservedAt: true },
      }),
      this.prisma.agenticHold.findMany({
        where: {
          restaurantId: args.restaurantId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          slotStart: { lt: dayEnd },
          slotEnd: { gt: dayStart },
        },
        select: { tableId: true, slotStart: true, slotEnd: true },
      }),
      args.preferredSectionId
        ? this.prisma.table.findMany({
            where: {
              sectionId: args.preferredSectionId,
              isActive: true,
              floorPlan: { restaurantId: args.restaurantId, isActive: true },
              capacity: { gte: args.partySize },
            },
            select: { id: true, capacity: true, minCapacity: true, sectionId: true },
          })
        : this.prisma.table.findMany({
            where: {
              isActive: true,
              floorPlan: { restaurantId: args.restaurantId, isActive: true },
              capacity: { gte: args.partySize },
            },
            select: { id: true, capacity: true, minCapacity: true, sectionId: true },
          }),
    ]);

    const busyByTable = new Map<string, Array<{ start: Date; end: Date }>>();
    const globallyBlockedIntervals: Array<{ start: Date; end: Date }> = [];
    for (const r of reservations) {
      const start = r.startsAt ?? r.reservedAt;
      const end = r.endsAt ?? new Date(start.getTime() + serviceDurationMinutes * 60_000);
      if (!r.tableId) {
        globallyBlockedIntervals.push({ start, end });
        continue;
      }
      const list = busyByTable.get(r.tableId) ?? [];
      list.push({ start, end });
      busyByTable.set(r.tableId, list);
    }
    for (const h of holds) {
      if (!h.tableId) {
        globallyBlockedIntervals.push({ start: h.slotStart, end: h.slotEnd });
        continue;
      }
      const list = busyByTable.get(h.tableId) ?? [];
      list.push({ start: h.slotStart, end: h.slotEnd });
      busyByTable.set(h.tableId, list);
    }

    const slots: AvailabilitySlot[] = allSlots.map((time) => {
      const slotStart = zonedTimeToUtc(args.date, time, timeZone);
      const slotEnd = new Date(slotStart.getTime() + serviceDurationMinutes * 60_000);

      const hasAvailableTable = (candidateTables: typeof tables) =>
        candidateTables.some((table) => {
          if (table.minCapacity > args.partySize) return false;
          const busy = busyByTable.get(table.id) ?? [];
          return !busy.some((b) => intervalsOverlap(b.start, b.end, slotStart, slotEnd));
        });

      const hasGlobalConflict = globallyBlockedIntervals.some((interval) =>
        intervalsOverlap(interval.start, interval.end, slotStart, slotEnd),
      );
      const available = !hasGlobalConflict && hasAvailableTable(tables);

      return { time, available };
    });

    const dto: AvailabilityDto = {
      restaurantId: args.restaurantId,
      date: args.date,
      partySize: args.partySize,
      slots,
    };

    try {
      version = await this.getVersion(args.restaurantId);
      await redisCache.set(
        this.cacheKey(args, version),
        JSON.stringify(dto),
        'EX',
        AVAILABILITY_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, args },
        'availability cache write failed',
      );
    }

    return dto;
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

function computeDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

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
