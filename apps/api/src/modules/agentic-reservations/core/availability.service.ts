/**
 * Availability service : coarse search + precise check de disponibilité.
 *
 * Coarse search : "quels restos ont des dispos à cette date pour N personnes ?"
 * Precise check : "le resto X a-t-il une table dispo à 19:30 pour 4 ?"
 *
 * Source de vérité : on regarde les AgenticHold ACTIVE et les Reservation
 * CONFIRMED/PENDING/SEATED. Les holds EXPIRED (même en avance) sont ignorés.
 *
 * Le modèle P0 ultra-conservateur : 1 seule table par slot/party_size.
 * Donc check_availability renvoie "available" si aucun hold actif + aucune
 * résa confirmée pour exactement (restaurant, slotStart, partySize).
 */

import type { PrismaClient } from '@prisma/client';
import type { RestaurantPolicyInput } from './policies.service.js';
import { buildPolicySnapshot } from './policies.service.js';
import {
  CapacityAwareAvailabilityService,
  zonedTimeToUtc,
} from '../../floor-plan/availability-capacity-aware.service.js';

/** Garde-fou : nombre max de candidats restaurant à évaluer par recherche */
const SEARCH_CANDIDATES_MAX = 200;

export type AvailabilityQuery = {
  restaurantId: string;
  partySize: number;
  slotStart: Date;
  slotEnd: Date;
};

export type AvailabilityResult = {
  available: boolean;
  conflictingHoldId?: string;
  conflictingReservationId?: string;
  reason?: 'hold_active' | 'reservation_confirmed' | 'party_size_exceeds_capacity' | 'unknown';
  /** Maximum party size that can be booked online for this restaurant. */
  maxOnlinePartySize?: number;
};

export type CapacityLimitHint = {
  restaurantId: string;
  name: string;
  slug: string | null;
  maxOnlinePartySize: number;
};

type FloorPlanCapacitySnapshot = {
  tables?: Array<{ capacity: number }>;
};

/**
 * The online limit is the most restrictive of the restaurant policy and the
 * largest active physical table. Keeping this calculation in one place avoids
 * exposing a policy limit that the floor plan cannot actually fulfil.
 */
export function resolveEffectiveMaxPartySize(args: {
  policyMaxPartySize?: number | null;
  floorPlans?: FloorPlanCapacitySnapshot[] | null;
}): number | null {
  const policyMax =
    typeof args.policyMaxPartySize === 'number' && args.policyMaxPartySize > 0
      ? args.policyMaxPartySize
      : null;
  const tableCapacities = (args.floorPlans ?? [])
    .flatMap((floorPlan) => floorPlan.tables ?? [])
    .map((table) => table.capacity)
    .filter((capacity) => Number.isFinite(capacity) && capacity > 0);
  const physicalMax = tableCapacities.length > 0 ? Math.max(...tableCapacities) : null;

  if (policyMax === null) return physicalMax;
  if (physicalMax === null) return policyMax;
  return Math.min(policyMax, physicalMax);
}

export class AvailabilityService {
  private readonly capacityAware: CapacityAwareAvailabilityService;

  constructor(private readonly prisma: PrismaClient) {
    this.capacityAware = new CapacityAwareAvailabilityService(prisma);
  }

  /**
   * Coarse search : retourne les restos qui ont de la dispo pour une plage
   * donnée. Utilise une heuristique simple (count des holds + résas actives
   * par resto) et filtre ceux qui ont de la marge.
   */
  async searchAvailableRestaurants(args: {
    city: string;
    partySize: number;
    slotStart: Date;
    slotEnd: Date;
    cuisineType?: string[];
    maxResults: number;
  }): Promise<
    Array<{
      restaurantId: string;
      name: string;
      slug: string | null;
      distanceMeters: number | null;
    }>
  > {
    // Étape 1 : candidats (filtre ville + cuisine + opt-in)
    const candidates = await this.prisma.restaurant.findMany({
      where: {
        agenticOptIn: true,
        exposureSettings: {
          is: {
            mcpEnabled: true,
          },
        },
        ...(args.cuisineType && args.cuisineType.length > 0
          ? { cuisineType: { hasSome: args.cuisineType } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        lat: true,
        lng: true,
        formattedAddress: true,
      },
      take: SEARCH_CANDIDATES_MAX, // garde-fou
    });

    // Filtre grossier par adresse/ville (le partial match se fait côté DB via
    // un LIKE — l'index GIN pg_trgm accélérera en P1)
    const lowerCity = args.city.toLowerCase();
    const filtered = candidates.filter((r) => {
      const addr = r.formattedAddress?.toLowerCase() ?? '';
      return lowerCity.length === 0 || addr.includes(lowerCity);
    });

    // Étape 2 : pour chaque candidat, vérifie la dispo sur le slot exact
    const results: Array<{ id: string; name: string; slug: string | null }> = [];
    for (const c of filtered) {
      const check = await this.checkAvailability({
        restaurantId: c.id,
        partySize: args.partySize,
        slotStart: args.slotStart,
        slotEnd: args.slotEnd,
      });
      if (check.available) {
        results.push({ id: c.id, name: c.name, slug: c.slug });
        if (results.length >= args.maxResults) break;
      }
    }

    return results.map((r) => ({
      restaurantId: r.id,
      name: r.name,
      slug: r.slug,
      distanceMeters: null, // PostGIS en P1 si besoin
    }));
  }

  /**
   * Explains why a requested group is too large without pretending the
   * restaurant does not exist. This is intentionally separate from the
   * availability search so the normal result contract stays unchanged.
   */
  async findCapacityLimits(args: {
    city: string;
    partySize: number;
    cuisineType?: string[];
    maxResults: number;
  }): Promise<CapacityLimitHint[]> {
    const candidates = await this.prisma.restaurant.findMany({
      where: {
        agenticOptIn: true,
        exposureSettings: { is: { mcpEnabled: true } },
        ...(args.cuisineType && args.cuisineType.length > 0
          ? { cuisineType: { hasSome: args.cuisineType } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        formattedAddress: true,
        exposureSettings: { select: { maxPartySize: true } },
        floorPlans: {
          where: { isActive: true },
          select: {
            tables: {
              where: { isActive: true },
              select: { capacity: true },
            },
          },
        },
      },
      take: SEARCH_CANDIDATES_MAX,
    });

    const lowerCity = args.city.toLowerCase();
    return candidates
      .filter((restaurant) => {
        const address = restaurant.formattedAddress?.toLowerCase() ?? '';
        return lowerCity.length === 0 || address.includes(lowerCity);
      })
      .map((restaurant) => {
        const maxOnlinePartySize = resolveEffectiveMaxPartySize({
          policyMaxPartySize: restaurant.exposureSettings?.maxPartySize,
          floorPlans: restaurant.floorPlans,
        });
        if (maxOnlinePartySize === null || args.partySize <= maxOnlinePartySize) return null;
        return {
          restaurantId: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          maxOnlinePartySize,
        } satisfies CapacityLimitHint;
      })
      .filter((hint): hint is CapacityLimitHint => hint !== null)
      .slice(0, args.maxResults);
  }

  /**
   * Precise check : est-ce que le slot est libre pour ce resto + party size ?
   * Renvoie un objet AvailabilityResult avec la raison du conflit.
   *
   * Wrapper autour de CapacityAwareAvailabilityService.
   */
  async checkAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: query.restaurantId },
      select: {
        timezone: true,
        exposureSettings: { select: { maxPartySize: true } },
        floorPlans: {
          where: { isActive: true },
          select: {
            tables: {
              where: { isActive: true },
              select: { capacity: true },
            },
          },
        },
      },
    });
    if (!restaurant) {
      return { available: false, reason: 'unknown' };
    }

    const maxOnlinePartySize = resolveEffectiveMaxPartySize({
      policyMaxPartySize: restaurant.exposureSettings?.maxPartySize,
      floorPlans: restaurant.floorPlans,
    });
    if (maxOnlinePartySize !== null && query.partySize > maxOnlinePartySize) {
      return {
        available: false,
        reason: 'party_size_exceeds_capacity',
        maxOnlinePartySize,
      };
    }

    const timeZone = restaurant.timezone ?? 'Europe/Paris';
    const dateStr = query.slotStart.toISOString().slice(0, 10);
    const timeStr = query.slotStart.toISOString().slice(11, 16);
    const slotStart = zonedTimeToUtc(dateStr, timeStr, timeZone);

    const dto = await this.capacityAware.getAvailability({
      restaurantId: query.restaurantId,
      date: dateStr,
      partySize: query.partySize,
    });

    const slot = dto.slots.find((s) => s.time === slotStart.toISOString().slice(11, 16));
    if (slot?.available) {
      return { available: true };
    }

    return { available: false, reason: 'unknown' };
  }

  /**
   * Renvoie les policy snapshot d'un restaurant.
   * Utilitaire pour chaînage avec hold.service et reservation.service.
   */
  async getPolicyFor(restaurantId: string): Promise<{
    policy: ReturnType<typeof buildPolicySnapshot>;
    settings: RestaurantPolicyInput | null;
  }> {
    const settings = await this.prisma.restaurantExposureSettings.findUnique({
      where: { restaurantId },
    });
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { policyVersion: true },
    });

    const input: RestaurantPolicyInput = {
      policyVersion: restaurant?.policyVersion ?? '2026-06-20',
      maxPartySize: settings?.maxPartySize ?? null,
      minLeadTimeMinutes: settings?.minLeadTimeMinutes ?? null,
      requireManualValidation: settings?.requireManualValidation ?? null,
      quoteTtlSeconds: settings?.quoteTtlSeconds ?? null,
      holdTtlSeconds: settings?.holdTtlSeconds ?? null,
      noShowPolicy: settings?.noShowPolicy ?? null,
      notificationChannels: settings?.notificationChannels ?? [],
      capacitySpecials: (settings?.capacitySpecials as Record<string, unknown> | null) ?? null,
    };

    return {
      policy: buildPolicySnapshot(input),
      settings: input,
    };
  }
}
