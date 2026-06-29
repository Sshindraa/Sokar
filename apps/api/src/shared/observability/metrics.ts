/**
 * Métriques Prometheus custom pour Sokar.
 *
 * Métriques exposées (Phase 6) :
 *   - sokar_agentic_hold_created_total{type,channel}
 *   - sokar_agentic_reservation_state_transitions_total{from,to,channel}
 *   - sokar_agentic_check_availability_duration_ms (histogram)
 *   - sokar_agentic_idempotency_hits_total{result}
 *   - sokar_agentic_pii_leaks_total{kind}
 *   - sokar_agentic_double_booking_attempts_total
 *
 * Endpoint : GET /metrics (texte Prometheus, scraped par Grafana).
 */

import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

let registry: Registry | null = null;

function getRegistry(): Registry {
  if (registry) return registry;
  registry = new Registry();
  // Collecte les métriques par défaut (process_cpu, nodejs_*, etc.)
  collectDefaultMetrics({ register: registry });
  return registry;
}

// ─── Hold created ─────────────────────────────────────────────

export const holdCreatedTotal = new Counter({
  name: 'sokar_agentic_hold_created_total',
  help: 'Total AgenticHold created',
  labelNames: ['type', 'channel'] as const,
  registers: [getRegistry()],
});

// ─── Reservation state transitions ────────────────────────────

export const reservationStateTransitionsTotal = new Counter({
  name: 'sokar_agentic_reservation_state_transitions_total',
  help: 'Total reservation state transitions',
  labelNames: ['from', 'to', 'channel'] as const,
  registers: [getRegistry()],
});

// ─── check_availability duration ──────────────────────────────

export const checkAvailabilityDuration = new Histogram({
  name: 'sokar_agentic_check_availability_duration_ms',
  help: 'Duration of check_availability tool calls in milliseconds',
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [getRegistry()],
});

// ─── Idempotency hits ─────────────────────────────────────────

export const idempotencyHitsTotal = new Counter({
  name: 'sokar_agentic_idempotency_hits_total',
  help: 'Total idempotency lookups by outcome',
  labelNames: ['result'] as const, // 'hit', 'miss', 'conflict'
  registers: [getRegistry()],
});

// ─── PII leaks (détection par regex sur tool responses) ───────

export const piiLeaksTotal = new Counter({
  name: 'sokar_agentic_pii_leaks_total',
  help: 'Total PII leaks detected in tool responses (should be 0)',
  labelNames: ['kind'] as const, // 'phone', 'email', 'hex'
  registers: [getRegistry()],
});

// ─── Double booking attempts ──────────────────────────────────

export const doubleBookingAttemptsTotal = new Counter({
  name: 'sokar_agentic_double_booking_attempts_total',
  help: 'Total double booking attempts blocked (should be 0 with partial unique index)',
  registers: [getRegistry()],
});

// ─── Render ───────────────────────────────────────────────────

/**
 * Render le payload Prometheus pour /metrics.
 * Format texte, compatible scraper Prometheus / Grafana Agent.
 */
export async function renderMetrics(): Promise<string> {
  return getRegistry().metrics();
}

/**
 * Reset toutes les métriques (test only).
 */
export function __resetMetrics(): void {
  holdCreatedTotal.reset();
  reservationStateTransitionsTotal.reset();
  checkAvailabilityDuration.reset();
  idempotencyHitsTotal.reset();
  piiLeaksTotal.reset();
  doubleBookingAttemptsTotal.reset();
  connectEventsTotal.reset();
  connectReservationsConfirmedTotal.reset();
}

// ─── Sokar Connect (Phase 1) ────────────────────────────────────────

/**
 * Compteur global des events Sokar Connect. Labels limités pour éviter la
 * cardinalité infinie (cf. spec v1.1 §16.1 — events standardisés).
 * Labels : event (page_view, cta_clicked, availability_requested,
 *                hold_created, hold_expired, reservation_confirmed,
 *                reservation_failed) × source (web, google, chatgpt, ...).
 */
export const connectEventsTotal = new Counter({
  name: 'sokar_connect_events_total',
  help: 'Total Sokar Connect events received',
  labelNames: ['event', 'source'] as const,
  registers: [getRegistry()],
});

/**
 * Réservations confirmées via Sokar Connect (par source).
 * Permet de calculer la conversion par canal SEO/agentic.
 */
export const connectReservationsConfirmedTotal = new Counter({
  name: 'sokar_connect_reservations_confirmed_total',
  help: 'Total reservations confirmed via Sokar Connect',
  labelNames: ['source', 'city'] as const,
  registers: [getRegistry()],
});
