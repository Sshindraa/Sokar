/**
 * Policies service pour l'agentic reservations.
 *
 * Responsabilité : résoudre les policies d'un restaurant et calculer les
 * TTL des tokens quote/hold. Le snapshot persisté dans Reservation
 * (cancellationPolicySnap / noShowPolicySnap) capture l'état au moment T
 * pour que les changements de policy ultérieurs ne rétroagissent pas
 * sur les résas existantes.
 */

import type { ReservationChannel } from './state-machine.js';
import { HOURS_PER_DAY, HOURS_TO_MINUTES, HOUR_SECONDS } from '../../../shared/constants/time.js';

export const DEFAULT_QUOTE_TTL_SECONDS = 300; // 5 min
export const DEFAULT_HOLD_TTL_SECONDS = 420; // 7 min
export const DEFAULT_MAX_PARTY_SIZE = 12;
export const DEFAULT_MIN_LEAD_TIME_MINUTES = 30;

/** Limite dure pour maxPartySize (validation des settings restaurant) */
export const MAX_PARTY_SIZE_HARD_LIMIT = 50;
/** Limite max pour minLeadTimeMinutes = 24h en minutes */
export const MAX_LEAD_TIME_MINUTES = HOURS_PER_DAY * HOURS_TO_MINUTES;
/** Limite max pour quoteTtlSeconds = 1h */
export const MAX_QUOTE_TTL_SECONDS = HOUR_SECONDS;
/** Limite max pour holdTtlSeconds = 1h */
export const MAX_HOLD_TTL_SECONDS = HOUR_SECONDS;
/** Annulation gratuite par défaut : 120 min avant le créneau */
export const DEFAULT_FREE_CANCELLATION_MINUTES = 120;
/** Seuil d'avertissement no-show par défaut */
export const DEFAULT_NOSHOW_WARNING_THRESHOLD = 2;

export type ExposedCreneau = {
  /** 0 = dimanche, 6 = samedi */
  day: number;
  /** HH:mm */
  from: string;
  /** HH:mm */
  to: string;
};

export type NoShowPolicyKind = 'warning' | 'fee' | 'block';

export type CancellationPolicySnap = {
  freeUntilMinutesBefore: number;
  feeAmount?: number;
  feeCurrency?: string;
  version: string;
};

export type NoShowPolicySnap = {
  kind: NoShowPolicyKind;
  feeAmount?: number;
  feeCurrency?: string;
  warningThreshold: number;
  version: string;
};

export type PolicySnapshot = {
  cancellation: CancellationPolicySnap;
  noShow: NoShowPolicySnap;
  maxPartySize: number;
  minLeadTimeMinutes: number;
  requireManualValidation: boolean;
  quoteTtlSeconds: number;
  holdTtlSeconds: number;
  notificationChannels: string[];
  policyVersion: string;
};

export type RestaurantPolicyInput = {
  policyVersion: string;
  maxPartySize: number | null | undefined;
  minLeadTimeMinutes: number | null | undefined;
  requireManualValidation: boolean | null | undefined;
  quoteTtlSeconds: number | null | undefined;
  holdTtlSeconds: number | null | undefined;
  noShowPolicy: string | null | undefined;
  notificationChannels: string[];
  capacitySpecials: Record<string, unknown> | null | undefined;
};

export class PolicyValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PolicyValidationError';
  }
}

/**
 * Valide que les settings d'un restaurant sont cohérents.
 * Jette PolicyValidationError sinon.
 */
export function validateExposureSettings(input: {
  maxPartySize?: number | null;
  minLeadTimeMinutes?: number | null;
  quoteTtlSeconds?: number | null;
  holdTtlSeconds?: number | null;
  noShowPolicy?: string | null;
}): void {
  const maxPartySize = input.maxPartySize ?? undefined;
  const minLeadTimeMinutes = input.minLeadTimeMinutes ?? undefined;
  const quoteTtlSeconds = input.quoteTtlSeconds ?? undefined;
  const holdTtlSeconds = input.holdTtlSeconds ?? undefined;
  const noShowPolicy = input.noShowPolicy ?? undefined;

  if (
    maxPartySize !== undefined &&
    (maxPartySize < 1 || maxPartySize > MAX_PARTY_SIZE_HARD_LIMIT)
  ) {
    throw new PolicyValidationError(
      `maxPartySize doit être entre 1 et ${MAX_PARTY_SIZE_HARD_LIMIT} (reçu ${maxPartySize})`,
      'INVALID_MAX_PARTY_SIZE',
    );
  }
  if (
    minLeadTimeMinutes !== undefined &&
    (minLeadTimeMinutes < 0 || minLeadTimeMinutes > MAX_LEAD_TIME_MINUTES)
  ) {
    throw new PolicyValidationError(
      `minLeadTimeMinutes doit être entre 0 et ${MAX_LEAD_TIME_MINUTES} (reçu ${minLeadTimeMinutes})`,
      'INVALID_MIN_LEAD_TIME',
    );
  }
  if (
    quoteTtlSeconds !== undefined &&
    (quoteTtlSeconds < 30 || quoteTtlSeconds > MAX_QUOTE_TTL_SECONDS)
  ) {
    throw new PolicyValidationError(
      `quoteTtlSeconds doit être entre 30 et ${MAX_QUOTE_TTL_SECONDS} (reçu ${quoteTtlSeconds})`,
      'INVALID_QUOTE_TTL',
    );
  }
  if (
    holdTtlSeconds !== undefined &&
    (holdTtlSeconds < 60 || holdTtlSeconds > MAX_HOLD_TTL_SECONDS)
  ) {
    throw new PolicyValidationError(
      `holdTtlSeconds doit être entre 60 et ${MAX_HOLD_TTL_SECONDS} (reçu ${holdTtlSeconds})`,
      'INVALID_HOLD_TTL',
    );
  }
  if (holdTtlSeconds !== undefined && quoteTtlSeconds !== undefined) {
    if (holdTtlSeconds <= quoteTtlSeconds) {
      throw new PolicyValidationError(
        `holdTtlSeconds (${holdTtlSeconds}) doit être supérieur à quoteTtlSeconds (${quoteTtlSeconds})`,
        'INVALID_TTL_ORDER',
      );
    }
  }
  if (noShowPolicy !== undefined && !['warning', 'fee', 'block'].includes(noShowPolicy)) {
    throw new PolicyValidationError(
      `noShowPolicy invalide (reçu ${noShowPolicy})`,
      'INVALID_NO_SHOW_POLICY',
    );
  }
}

function isNoShowPolicyKind(v: string | undefined): v is NoShowPolicyKind {
  return v === 'warning' || v === 'fee' || v === 'block';
}

/**
 * Construit le snapshot de policy au moment d'une résa.
 * Ce snapshot sera stocké dans Reservation.cancellationPolicySnap
 * et Reservation.noShowPolicySnap pour figer l'état à T.
 */
export function buildPolicySnapshot(input: RestaurantPolicyInput): PolicySnapshot {
  return {
    cancellation: {
      freeUntilMinutesBefore: DEFAULT_FREE_CANCELLATION_MINUTES,
      feeAmount: undefined,
      feeCurrency: 'EUR',
      version: input.policyVersion,
    },
    noShow: {
      kind: isNoShowPolicyKind(input.noShowPolicy ?? undefined)
        ? (input.noShowPolicy as NoShowPolicyKind)
        : 'warning',
      feeAmount: undefined,
      feeCurrency: 'EUR',
      warningThreshold: DEFAULT_NOSHOW_WARNING_THRESHOLD,
      version: input.policyVersion,
    },
    maxPartySize: input.maxPartySize ?? DEFAULT_MAX_PARTY_SIZE,
    minLeadTimeMinutes: input.minLeadTimeMinutes ?? DEFAULT_MIN_LEAD_TIME_MINUTES,
    requireManualValidation: input.requireManualValidation ?? false,
    quoteTtlSeconds: input.quoteTtlSeconds ?? DEFAULT_QUOTE_TTL_SECONDS,
    holdTtlSeconds: input.holdTtlSeconds ?? DEFAULT_HOLD_TTL_SECONDS,
    notificationChannels:
      input.notificationChannels.length > 0 ? input.notificationChannels : ['sms', 'email'],
    policyVersion: input.policyVersion,
  };
}

/**
 * Valide qu'une demande de résa respecte les policies du restaurant.
 * Renvoie le policySnapshot si OK, jette PolicyValidationError sinon.
 */
export function validateReservationAgainstPolicy(
  snapshot: PolicySnapshot,
  request: {
    partySize: number;
    startsAt: Date;
    channel: ReservationChannel;
  },
): void {
  if (request.partySize < 1) {
    throw new PolicyValidationError('partySize doit être >= 1', 'INVALID_PARTY_SIZE');
  }
  if (request.partySize > snapshot.maxPartySize) {
    throw new PolicyValidationError(
      `partySize ${request.partySize} dépasse maxPartySize ${snapshot.maxPartySize}`,
      'PARTY_SIZE_EXCEEDS_MAX',
    );
  }

  const now = Date.now();
  const start = request.startsAt.getTime();
  const minutesBefore = (start - now) / 60_000;

  if (minutesBefore < snapshot.minLeadTimeMinutes) {
    throw new PolicyValidationError(
      `Insufficient lead time: ${Math.round(minutesBefore)}min avant, minimum ${snapshot.minLeadTimeMinutes}min requis`,
      'INSUFFICIENT_LEAD_TIME',
    );
  }
}

/**
 * Calcule la date d'expiration d'un quote.
 */
export function computeQuoteExpiresAt(snapshot: PolicySnapshot, now: Date = new Date()): Date {
  return new Date(now.getTime() + snapshot.quoteTtlSeconds * 1000);
}

/**
 * Calcule la date d'expiration d'un hold.
 */
export function computeHoldExpiresAt(snapshot: PolicySnapshot, now: Date = new Date()): Date {
  return new Date(now.getTime() + snapshot.holdTtlSeconds * 1000);
}
