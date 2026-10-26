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

import { PrismaClient, type Prisma } from '@prisma/client';
import { bookingSlotsOf, normalizeOpeningHours } from '@sokar/shared';
import type { AvailabilityDto, AvailabilitySlot } from './floor-plan.types';
import { resolveServiceDurationMinutes } from './floor-plan.types';
import { TableAllocationService } from './table-allocation.service';
import { redisCache } from '../../shared/redis/client';
import { logger } from '../../shared/logger/pino';
import { ACTIVE_RESERVATION_STATES, intervalsOverlap } from '../../shared/reservations/capacity.js';
import {
  DEFAULT_RESTAURANT_TIMEZONE,
  zonedTimeToUtc,
} from '../../shared/timezone/restaurant-time.js';
import { isSlotTooSoonAt } from '../../shared/reservations/lead-time.js';

// Compatibilité pour les callers internes existants. L'implémentation est
// désormais centralisée dans shared/timezone.
export {
  DEFAULT_RESTAURANT_TIMEZONE,
  utcToZonedParts,
  zonedTimeToUtc,
} from '../../shared/timezone/restaurant-time.js';

const SLOT_MINUTES = 30;
const AVAILABILITY_CACHE_TTL_SECONDS = 30;
const AVAILABILITY_VERSION_TTL_SECONDS = 120;
const CACHE_KEY_PREFIX = 'availability:v:';
// Écarts UTC extrêmes en usage (UTC-12 à UTC+14) : bornent la journée locale d'une date, donc
// évitent de convertir chaque créneau quand la date est sans ambiguïté future ou passée.
const MAX_UTC_OFFSET_AHEAD_MS = 14 * 60 * 60 * 1000;
const MAX_UTC_OFFSET_BEHIND_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Valeur mise en cache : le résultat brut du moteur et le fuseau du restaurant. Le fuseau permet de
 * marquer les créneaux passés APRÈS la lecture du cache, sans recharger le restaurant.
 */
type CachedAvailability = { timeZone: string; dto: AvailabilityDto };

function parseCachedAvailability(raw: string): CachedAvailability | null {
  const parsed = JSON.parse(raw) as Partial<CachedAvailability> | null;
  // Ancien format (le DTO seul, sans fuseau) : ignoré, la valeur est recalculée.
  if (!parsed || typeof parsed.timeZone !== 'string' || !parsed.dto) return null;
  return { timeZone: parsed.timeZone, dto: parsed.dto };
}

/**
 * Les créneaux déjà commencés, ou qui commencent avant maintenant plus le délai minimum, passent à
 * `available: false`. Ils restent dans le tableau : un appelant qui cherche une heure doit lire
 * « indisponible », pas « introuvable ». Le DTO reçu n'est jamais modifié (il peut être celui que le
 * cache vient de stocker). `minLeadTimeMinutes` vaut 0 sauf pour les surfaces en ligne.
 */
export function markTooSoonSlotsUnavailable(
  dto: AvailabilityDto,
  timeZone: string,
  now: Date,
  minLeadTimeMinutes: number = 0,
): AvailabilityDto {
  const dayStart = Date.parse(`${dto.date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart)) return dto;
  const lead = Number.isFinite(minLeadTimeMinutes) ? Math.max(0, minLeadTimeMinutes) : 0;
  // Dès cet instant, un créneau est réservable : `maintenant + délai` est le plus petit début permis.
  const earliestBookableMs = now.getTime() + lead * 60_000;
  // Tous les créneaux de la date commencent au plus tôt à `earliestStartMs` (minuit local en UTC+14) :
  // si maintenant et maintenant + délai ne l'atteignent pas, rien n'est trop proche.
  const earliestStartMs = dayStart - MAX_UTC_OFFSET_AHEAD_MS;
  if (now.getTime() < earliestStartMs && earliestBookableMs <= earliestStartMs) return dto;
  const allTooSoon = earliestBookableMs >= dayStart + DAY_MS + MAX_UTC_OFFSET_BEHIND_MS;
  return {
    ...dto,
    slots: dto.slots.map((slot) =>
      slot.available && (allTooSoon || isSlotTooSoonAt(dto.date, slot.time, timeZone, lead, now))
        ? { ...slot, available: false }
        : slot,
    ),
  };
}

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
   * Plages d'accueil (min et max de couverts) des tables actives, celles que `getAvailability` retient : un
   * groupe qu'aucune plage n'accueille n'a de créneau AUCUN jour, ce qui n'est pas « complet ce jour-là ».
   * Les combinaisons de tables ne comptent pas : la disponibilité ne les utilise pas.
   */
  async tableRanges(
    restaurantId: string,
  ): Promise<Array<{ capacity: number; minCapacity: number }>> {
    return this.prisma.table.findMany({
      where: { isActive: true, floorPlan: { restaurantId, isActive: true } },
      select: { capacity: true, minCapacity: true },
    });
  }

  /**
   * Retourne les créneaux disponibles pour (restaurantId, date, partySize).
   * Un créneau est disponible si au moins une table active peut accueillir le
   * groupe sur la durée du service.
   */
  async getAvailability(
    args: {
      restaurantId: string;
      date: string; // YYYY-MM-DD
      partySize: number;
      preferredSectionId?: string;
      /** Horloge injectable (tests) : par défaut, l'instant de l'appel. */
      now?: Date;
      /** Private modification preview: never read or populate the public cache. */
      excludeReservationId?: string;
      defaultFloorOnly?: boolean;
      /**
       * Délai minimum de réservation, en minutes. Passé par les surfaces EN LIGNE (page et widget
       * Connect, page /book, cartes cadeaux) ; absent (donc 0) pour le téléphone et le personnel.
       */
      minLeadTimeMinutes?: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<AvailabilityDto> {
    const queryDb = tx ?? this.prisma;
    const privatePreview = !!args.excludeReservationId || !!tx || !!args.defaultFloorOnly;
    // Une seule lecture de l'horloge par appel : le cache garde le résultat brut (sans passé ni délai),
    // ils se marquent à chaque lecture, y compris pour une valeur en cache depuis quelques secondes.
    // Le délai n'entre pas dans la clé de cache : il ne change que ce qu'on marque après.
    const now = args.now ?? new Date();
    let version = 0;
    if (!privatePreview)
      try {
        version = await this.getVersion(args.restaurantId);
        const cached = await redisCache.get(this.cacheKey(args, version));
        const hit = cached ? parseCachedAvailability(cached) : null;
        if (hit) {
          return markTooSoonSlotsUnavailable(hit.dto, hit.timeZone, now, args.minLeadTimeMinutes);
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, args },
          'availability cache read failed',
        );
      }

    const restaurant = await queryDb.restaurant.findUnique({
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
    const dayHours = openingHours.filter((period) => period.dayIndex === dayOfWeek);

    if (dayHours.length === 0) {
      return emptyAvailability(args);
    }

    const allSlots = Array.from(
      new Set(dayHours.flatMap((period) => bookingSlotsOf(period, SLOT_MINUTES))),
    ).sort();
    if (allSlots.length === 0) {
      return emptyAvailability(args);
    }

    // Récupérer toutes les réservations bloquantes et holds actifs du jour
    // pour les tester localement (optimisation P1).
    const dayStart = zonedTimeToUtc(args.date, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(args.date, '23:59:59.999', timeZone);

    const [reservations, holds, tables] = await Promise.all([
      queryDb.reservation.findMany({
        where: {
          restaurantId: args.restaurantId,
          state: { in: [...ACTIVE_RESERVATION_STATES] },
          ...(args.excludeReservationId ? { id: { not: args.excludeReservationId } } : {}),
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
      queryDb.agenticHold.findMany({
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
        ? queryDb.table.findMany({
            where: {
              sectionId: args.preferredSectionId,
              isActive: true,
              floorPlan: {
                restaurantId: args.restaurantId,
                isActive: true,
                ...(args.defaultFloorOnly ? { isDefault: true } : {}),
              },
              capacity: { gte: args.partySize },
            },
            select: { id: true, capacity: true, minCapacity: true, sectionId: true },
          })
        : queryDb.table.findMany({
            where: {
              isActive: true,
              floorPlan: {
                restaurantId: args.restaurantId,
                isActive: true,
                ...(args.defaultFloorOnly ? { isDefault: true } : {}),
              },
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

    if (!privatePreview)
      try {
        // Version lue AVANT le calcul : une mutation survenue entre-temps l'a déjà dépassée, donc ce
        // résultat peut-être périmé n'est jamais relu.
        const entry: CachedAvailability = { timeZone, dto };
        await redisCache.set(
          this.cacheKey(args, version),
          JSON.stringify(entry),
          'EX',
          AVAILABILITY_CACHE_TTL_SECONDS,
        );
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, args },
          'availability cache write failed',
        );
      }

    return markTooSoonSlotsUnavailable(dto, timeZone, now, args.minLeadTimeMinutes);
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
