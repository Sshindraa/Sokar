/**
 * Sokar Floor Plan — Types partagés pour l'allocation de tables et la
 * disponibilité capacité-aware.
 */

export type AvailabilitySlot = {
  time: string;
  available: boolean;
};

export type AvailabilityDto = {
  restaurantId: string;
  date: string;
  partySize: number;
  slots: AvailabilitySlot[];
};

export type ServiceDurationInput = {
  serviceDurationMinutes?: number;
  defaultServiceDurationMinutes?: number;
};

export const DEFAULT_SERVICE_DURATION_MINUTES = 120;

/**
 * Résout la durée d'un service (en minutes) depuis les capacitySpecials.
 *
 * Ordre de priorité :
 * 1. serviceDurationMinutes explicite
 * 2. defaultServiceDurationMinutes
 * 3. fallback 120 min
 */
export function resolveServiceDurationMinutes(specials: unknown): number {
  if (!specials || typeof specials !== 'object' || Array.isArray(specials)) {
    return DEFAULT_SERVICE_DURATION_MINUTES;
  }

  const s = specials as ServiceDurationInput;

  if (typeof s.serviceDurationMinutes === 'number' && s.serviceDurationMinutes > 0) {
    return s.serviceDurationMinutes;
  }

  if (typeof s.defaultServiceDurationMinutes === 'number' && s.defaultServiceDurationMinutes > 0) {
    return s.defaultServiceDurationMinutes;
  }

  return DEFAULT_SERVICE_DURATION_MINUTES;
}

export type AllocateTableInput = {
  restaurantId: string;
  partySize: number;
  startsAt: Date;
  endsAt: Date;
  preferredSectionId?: string;
  excludeTableIds?: string[];
};

/**
 * Proposition d'allocation explicable (Phase 5).
 *
 * - `score` : ordre de tri décroissant (fit capacité puis section préférée).
 * - `reasons` : libellés FR (vouvoiement) expliquant pourquoi cette table est
 *   proposée, affichés tels quels dans le dashboard.
 */
export type AllocationSuggestion = {
  table: {
    id: string;
    name: string;
    capacity: number;
    minCapacity: number;
    sectionId: string | null;
  };
  score: number;
  reasons: string[];
};

export type TableAvailabilityCheck = {
  tableId: string;
  startsAt: Date;
  endsAt: Date;
  excludeReservationId?: string;
  excludeHoldId?: string;
};
