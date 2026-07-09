/**
 * Constantes TTS spécifiques au voice stream.
 *
 * Délais de pacing audio, retry Cartesia, et pauses de streaming.
 */

/** Délai de retry après un échec Cartesia (5xx ou 429) */
export const CARTESIA_RETRY_DELAY_MS = 200;

/** Nombre max de tentatives de requête Cartesia TTS */
export const CARTESIA_TTS_MAX_ATTEMPTS = 2;

/** Pause entre les chunks audio envoyés à Telnyx (ms) — 20ms = 160 bytes à 8kHz */
export const TTS_CHUNK_PAUSE_MS = 20;

/** Pause quand le buffer de playback est sous-alimenté (ms) */
export const TTS_UNDERFEED_PAUSE_MS = 10;

/** Pause de pacing pour le streaming audio (ms) */
export const TTS_PACE_PAUSE_MS = 20;
