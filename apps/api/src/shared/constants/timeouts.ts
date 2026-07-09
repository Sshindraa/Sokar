/**
 * Timeouts et intervalles explicites partagés entre services.
 *
 * Chaque constante documente un délai métier ou technique
 * qui était auparavant un magic number en dur dans le code.
 */

/** Timeout de téléchargement d'une image de carte cadeau (PDF) */
export const PDF_IMAGE_FETCH_TIMEOUT_MS = 5000;

/** Reset fallback du rate limiter MCP quand Redis est down */
export const RATE_LIMIT_FALLBACK_RESET_MS = 5000;

/** Intervalle de polling pour l'idempotency (ms) */
export const IDEMPOTENCY_POLL_INTERVAL_MS = 50;

/** Nombre max de tentatives de polling pour l'idempotency */
export const IDEMPOTENCY_MAX_WAIT_ATTEMPTS = 20;

/** Délai avant fermeture du WebSocket Deepgram (finalize → close) */
export const DEEPGRAM_CLOSE_DELAY_MS = 200;

/** Fenêtre de dédoublonnage des transcripts (ms) */
export const TRANSCRIPT_DEDUPE_WINDOW_MS = 2000;
