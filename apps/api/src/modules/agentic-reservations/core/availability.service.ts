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
  reason?: 'hold_active' | 'reservation_confirmed' | 'unknown';
};

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
            maxPartySize: { gte: args.partySize },
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
      take: 200, // garde-fou
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
   * Precise check : est-ce que le slot est libre pour ce resto + party size ?
   * Renvoie un objet AvailabilityResult avec la raison du conflit.
   *
   * Wrapper autour de CapacityAwareAvailabilityService.
   */
  async checkAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: query.restaurantId },
      select: { timezone: true },
    });
    if (!restaurant) {
      return { available: false, reason: 'unknown' };
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
