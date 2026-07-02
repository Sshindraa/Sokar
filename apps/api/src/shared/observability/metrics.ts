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

// ─── OpenAI Reserve feed (visibilite, pas de blocage) ───────────────

/**
 * Compteur des requetes sur GET /v1/businesses (business feed public).
 * Permet de detecter un volume anormal (scraping massif, DoS applicatif)
 * sans bloquer personne a priori. La decision de bloquer viendra plus tard
 * si les metriques montrent un abus reel.
 * Labels : status (200, 400, 429, 500, cache_hit, cache_miss).
 */
export const openaiReserveFeedRequestsTotal = new Counter({
  name: 'sokar_openai_reserve_feed_requests_total',
  help: 'Total requests on GET /v1/businesses (OpenAI Reserve business feed)',
  labelNames: ['status'] as const,
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
  connectRequestDuration.reset();
  mcpToolCallsTotal.reset();
  connectIaBotHitsTotal.reset();
  openaiReserveFeedRequestsTotal.reset();
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

/**
 * Latence des requêtes sur les routes publiques Sokar Connect.
 * Permet de calculer le p95 (cible < 500ms, spec v1.1 §11.2).
 * Labels : route (slug, availability, hold, confirm) × status (2xx, 4xx, 5xx).
 */
export const connectRequestDuration = new Histogram({
  name: 'sokar_connect_request_duration_ms',
  help: 'Duration of Sokar Connect public API requests in milliseconds',
  labelNames: ['route', 'status'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [getRegistry()],
});

// ─── MCP Server (agentic reservations) ─────────────────────────────

/**
 * Compteur des appels par tool MCP. Permet de savoir quels tools sont
 * réellement utilisés par les clients MCP (Claude Desktop, Cursor, etc.)
 * et par quel agent (label agentClient).
 * Labels : tool (search, details, availability, create, cancel, status)
 *          × status (success, error, denied).
 */
export const mcpToolCallsTotal = new Counter({
  name: 'sokar_mcp_tool_calls_total',
  help: 'Total MCP tool calls by tool name and status',
  labelNames: ['tool', 'status'] as const,
  registers: [getRegistry()],
});

/**
 * Hits par bot IA sur les pages publiques Connect (crawl web).
 * Détecté côté Connect middleware (Edge), forwardé en fire-and-forget vers
 * l'endpoint analytics API qui incrémente ce compteur via la queue BullMQ.
 * Labels : bot (GPTBot, ClaudeBot, ...) × path_class (restaurant, llms.txt,
 *           sitemap, robots, well-known) — cardinalité bornée.
 */
export const connectIaBotHitsTotal = new Counter({
  name: 'sokar_connect_ia_bot_hits_total',
  help: 'Total IA bot hits on Sokar Connect public pages',
  labelNames: ['bot', 'path_class'] as const,
  registers: [getRegistry()],
});
