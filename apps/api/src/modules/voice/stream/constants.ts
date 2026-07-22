/**
 * Constantes TTS spécifiques au voice stream.
 *
 * Délais de pacing audio, retry Cartesia, et pauses de streaming.
 */

/** Délai de retry après un échec Cartesia (5xx ou 429) */
export const CARTESIA_RETRY_DELAY_MS = 200;

/** Nombre max de tentatives de requête Cartesia TTS */
export const CARTESIA_TTS_MAX_ATTEMPTS = 2;

/**
 * Une trame RTP G.711 de 100 ms à 8 kHz (1 octet = 1 échantillon).
 *
 * Telnyx accepte des trames entre 20 ms et 30 s. 20 ms est le minimum mais
 * dépend trop fortement des timers Node et produit des sous-alimentations sur
 * les réponses Cartesia plus longues. 100 ms réduit par cinq le nombre de
 * messages WebSocket tout en restant suffisamment court pour le barge-in.
 */
export const TTS_FRAME_DURATION_MS = 100;
export const TTS_FRAME_BYTES = 800;

/** Deux trames (200 ms) absorbent les variations d'arrivée du flux Cartesia. */
export const TTS_INITIAL_BUFFER_FRAMES = 2;

/** Pause quand le buffer de playback est sous-alimenté (ms) */
export const TTS_UNDERFEED_PAUSE_MS = 10;

/** Pause de pacing pour le streaming audio (ms) */
export const TTS_PACE_PAUSE_MS = TTS_FRAME_DURATION_MS;
