import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { CallSession, SttEvent, SttTurnConfig, SttWord } from './types';
import { CallSessionManager } from './manager';
import {
  isNameCollectionBlocking,
  isVoiceDialogueIncompleteTranscript,
} from './conversation-controller';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { isSpeculativeLlmEnabled } from './speculation';
import { describeTranscript } from './pii-redact';
import {
  voiceProviderErrorsTotal,
  voiceSttRelockTotal,
  voiceSttAudioMessagesTotal,
  voiceSttChunkBytes,
  voiceSttProviderAudioMessagesTotal,
  voiceSttProviderChunkBytes,
} from '../../../shared/observability/metrics';
import {
  getSttChunkMs,
  STT_CHUNK_MS_DEFAULT,
  STT_CHUNK_SAFETY_EXTRA_MS,
} from '../../../shared/stt-chunking';
import { telnyxBytesPerMs } from './telnyx-codec';
import {
  createDeepgramSttAdapter,
  createScribeSttAdapter,
  type NormalizedSttProviderMessage,
  type SttProviderAdapter,
  type SttProviderId,
} from './stt-provider-adapter';
import { resolveVoiceFeatureSnapshot } from './feature-flags';
import { addSttAudioSamples } from '../../usage/voice-usage.service';
import { alertTerminalSttUnavailable, recordSttConnectionUnavailable } from './stt-alerts';

const DEFAULT_STT_MODEL = 'scribe_v2_realtime';
const STT_REALTIME_PATH = '/v1/speech-to-text/realtime';
export const STT_RETRY_BACKOFF_MS = [500, 1_000, 2_000] as const;
export const STT_MAX_CONSECUTIVE_FAILURES = 4;
export const STT_MAX_RECONNECTIONS_PER_CALL = 8;
export const STT_CONNECT_TIMEOUT_MS = 2_500;
// Laisse passer quatre délais de connexion (4 × 2,5 s) et le backoff
// (3,5 s) avant le repli déclenché par la limite d'échecs consécutifs.
export const STT_UNAVAILABLE_DEADLINE_MS = 15_000;
export const DIALOGUE_V2_INCOMPLETE_HOLD_MS = 900;

export type SttWebSocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket;

function terminalSttReason(
  messageType: string | undefined,
): Extract<SttEvent, { type: 'Unavailable' }>['reason'] | null {
  const normalized = messageType?.toLowerCase() ?? '';
  if (normalized.includes('quota')) return 'quota';
  if (normalized.includes('unaccepted_terms') || normalized.includes('terms')) return 'terms';
  if (
    normalized.includes('auth') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden')
  )
    return 'auth';
  return null;
}

function clearSttRecoveryTimers(session: CallSession): void {
  if (session.sttRetryTimer) clearTimeout(session.sttRetryTimer);
  if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
  if (session.sttConnectionDeadlineTimer) clearTimeout(session.sttConnectionDeadlineTimer);
  session.sttRetryTimer = null;
  session.sttConnectTimeout = null;
  session.sttConnectionDeadlineTimer = null;
  if (session.sttKeepAliveTimer) clearInterval(session.sttKeepAliveTimer);
  session.sttKeepAliveTimer = null;
}

function triggerSttUnavailable(
  session: CallSession,
  reason: Extract<SttEvent, { type: 'Unavailable' }>['reason'],
  message: string,
): void {
  if (session.ended || session.sttFallbackTriggered) return;
  session.sttTerminalFailure = true;
  session.sttFallbackTriggered = true;
  clearSttRecoveryTimers(session);
  session.audioBuffer = [];
  if (reason === 'connection') {
    const provider = metricProvider(session);
    voiceProviderErrorsTotal.inc({
      provider,
      type: 'connection_unavailable',
    });
    recordSttConnectionUnavailable(undefined, provider).catch((error) =>
      logger.warn({ err: error }, '[stt] Could not dispatch connection alert'),
    );
  } else if (reason === 'quota' || reason === 'auth' || reason === 'terms') {
    alertTerminalSttUnavailable(reason, undefined, metricProvider(session)).catch((error) =>
      logger.warn({ err: error }, '[stt] Could not dispatch terminal provider alert'),
    );
  }
  const ws = session.sttWs;
  session.sttWs = null;
  session.sttReady = null;
  if (ws) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'STT unavailable');
      else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    } catch {
      // Un socket déjà fermée n'empêche pas le repli parlé.
    }
  }
  session.onSttEvent?.({ type: 'Unavailable', reason, message });
}

function ensureSttAvailabilityDeadline(session: CallSession): void {
  if (
    session.sttConnectionDeadlineTimer ||
    session.sttTerminalFailure ||
    session.sttFallbackTriggered
  )
    return;
  session.sttConnectionDeadlineTimer = setTimeout(() => {
    session.sttConnectionDeadlineTimer = null;
    if (session.sttWs?.readyState === WebSocket.OPEN) return;
    triggerSttUnavailable(
      session,
      'connection',
      'ElevenLabs Scribe did not become available before the connection deadline',
    );
  }, STT_UNAVAILABLE_DEADLINE_MS);
}

function handleSttConnectionFailure(
  session: CallSession,
  error: Error,
  createSocket: SttWebSocketFactory,
): void {
  if (scheduleAutoDetectAfterRelockFailure(session, createSocket)) return;
  if (fallbackToScribeAtOpening(session, createSocket)) return;
  if (session.ended || session.sttTerminalFailure || session.sttFallbackTriggered) return;
  session.sttConsecutiveFailures = (session.sttConsecutiveFailures ?? 0) + 1;
  if (session.sttConsecutiveFailures >= STT_MAX_CONSECUTIVE_FAILURES) {
    triggerSttUnavailable(session, 'connection', error.message);
    return;
  }
  if ((session.sttReconnectAttempts ?? 0) >= STT_MAX_RECONNECTIONS_PER_CALL) {
    triggerSttUnavailable(session, 'connection', error.message);
    return;
  }

  ensureSttAvailabilityDeadline(session);
  if (session.sttRetryTimer) return;
  const delay =
    STT_RETRY_BACKOFF_MS[
      Math.min(session.sttConsecutiveFailures - 1, STT_RETRY_BACKOFF_MS.length - 1)
    ];
  session.sttRetryTimer = setTimeout(() => {
    session.sttRetryTimer = null;
    if (session.ended || session.sttTerminalFailure || session.sttFallbackTriggered) return;
    session.sttReconnectAttempts = (session.sttReconnectAttempts ?? 0) + 1;
    connectStt(session, undefined, createSocket).catch(() => {
      // The connection attempt records its own failure and schedules the next retry.
    });
  }, delay);
}

/** Deepgram may fall back only before its first successful socket open. */
function fallbackToScribeAtOpening(
  session: CallSession,
  createSocket: SttWebSocketFactory,
): boolean {
  const adapter = session.sttAdapter;
  if (
    adapter?.id !== 'deepgram' ||
    session.sttProviderOpenedOnce ||
    session.sttOpeningFallbackAttempted ||
    session.ended
  ) {
    return false;
  }

  session.sttOpeningFallbackAttempted = true;
  session.sttAdapter = createScribeSttAdapter({ model: configuredModel(session) });
  session.sttModel = session.sttAdapter.model;
  session.sttConnectionAudioStartedAt = undefined;
  session.sttDeepgramFinalParts = [];
  session.sttConsecutiveFailures = 0;
  logger.warn(
    { callId: session.callControlId, failedProvider: 'deepgram_stt' },
    '[stt] Initial Deepgram connection failed; falling back to Scribe',
  );
  connectStt(session, undefined, createSocket).catch(() => {
    logger.warn(
      { callId: session.callControlId, provider: 'elevenlabs_stt' },
      '[stt] Opening fallback connection failed',
    );
  });
  return true;
}

/** A failed forced-French handshake restores the old auto-detect socket when possible. */
function scheduleAutoDetectAfterRelockFailure(
  session: CallSession,
  createSocket: SttWebSocketFactory,
): boolean {
  if (!session.sttRelockAttempt) return false;
  session.sttRelockAttempt = false;
  session.sttFrenchOnly = false;
  voiceSttRelockTotal.inc({ result: 'failed' });
  const failedSocket = session.sttWs;
  session.sttWs = null;
  session.sttReady = null;
  try {
    if (failedSocket?.readyState === WebSocket.OPEN) {
      failedSocket.close(1011, 'French language relock failed');
    }
  } catch {
    // The automatic-language reconnect below remains best effort.
  }
  if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
  if (session.sttConnectionDeadlineTimer) clearTimeout(session.sttConnectionDeadlineTimer);
  session.sttConnectTimeout = null;
  session.sttConnectionDeadlineTimer = null;
  if (session.sttRetryTimer) clearTimeout(session.sttRetryTimer);
  const previousSocket = session.sttRelockPreviousWs;
  session.sttRelockPreviousWs = null;
  if (previousSocket?.readyState === WebSocket.OPEN) {
    session.sttWs = previousSocket;
    session.sttReady = null;
    resumeSttAfterOpen(session);
    return true;
  }
  session.sttRetryTimer = setTimeout(() => {
    session.sttRetryTimer = null;
    if (session.ended || session.sttTerminalFailure || session.sttFallbackTriggered) return;
    connectStt(session, undefined, createSocket).catch(() => {
      // The normal reconnect path owns retries and eventual provider fallback.
    });
  }, 500);
  return true;
}

/** Called at the transition into TTS, never while the customer has the floor. */
export function beginFrenchSttRelock(
  session: CallSession,
  createSocket: SttWebSocketFactory = (url, options) => new WebSocket(url, options),
): void {
  if (
    sttAdapterForSession(session).id !== 'scribe' ||
    !session.sttRelockPending ||
    session.languageLocked !== 'fr' ||
    session.state !== 'SPEAKING' ||
    session.ended
  )
    return;

  const oldSocket = session.sttWs;
  if (oldSocket?.readyState !== WebSocket.OPEN) {
    if (!session.sttReady && !session.sttRetryTimer) {
      session.sttRelockPending = false;
      voiceSttRelockTotal.inc({ result: 'skipped' });
    }
    return;
  }

  clearSttChunkTimer(session);
  const pendingChunk = session.sttChunkBuffer;
  session.sttChunkBuffer = null;
  if (pendingChunk?.length) session.audioBuffer.push(pendingChunk);
  session.sttRelockPending = false;
  session.sttFrenchOnly = true;
  session.sttRelockAttempt = true;
  session.sttRelockPreviousWs = oldSocket;
  session.sttWs = null;
  session.sttReady = null;
  connectStt(session, undefined, createSocket).catch(() => {
    // scheduleAutoDetectAfterRelockFailure preserves the call if this fails.
  });
}

/**
 * Langues touristiques activées par défaut pour les appels de restaurant.
 * Scribe accepte plus de 90 langues, mais limiter la détection à ce périmètre
 * améliore l'identification sur un appel court et évite de promettre une
 * couverture que le restaurant n'a pas validée.
 */
// Banc du 24/09/2026 (voix téléphonique A-law 8 kHz, 21 essais) : toutes les
// langues → 33 % d'informations critiques justes (Scribe transcrit en allemand,
// néerlandais…), fr+en → 76 %. Chaque langue ajoutée augmente les confusions.
export const DEFAULT_STT_LANGUAGES = ['fr', 'en'] as const;
const STT_LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}$/u;

/**
 * Codes accepted by ElevenLabs Scribe for the 44-language opt-in.
 *
 * Cartesia uses short internal codes (for example `tl` for Tagalog), while
 * Scribe validates this list against its supported ISO codes (`fil` for
 * Filipino/Tagalog, `jpn` for Japanese, ...). Keeping this list separate is
 * important: the result is normalized back to Cartesia's short code later in
 * the voice pipeline.
 */
export const ALL_STT_LANGUAGES = [
  'eng',
  'fra',
  'deu',
  'spa',
  'por',
  'zho',
  'jpn',
  'hin',
  'ita',
  'kor',
  'nld',
  'pol',
  'rus',
  'swe',
  'tur',
  'fil',
  'bul',
  'ron',
  'ara',
  'ces',
  'ell',
  'fin',
  'hrv',
  'msa',
  'slk',
  'dan',
  'tam',
  'ukr',
  'hun',
  'nor',
  'vie',
  'ben',
  'tha',
  'heb',
  'kat',
  'ind',
  'tel',
  'guj',
  'kan',
  'mal',
  'mar',
  'pan',
  'ori',
  'urd',
] as const;

/** Aliases accepted in local configuration, normalized to Scribe's codes. */
const STT_LANGUAGE_ALIASES: Record<string, string> = {
  tl: 'fil',
  zh: 'zho',
  ja: 'jpn',
  ko: 'kor',
};

function normalizeSttLanguageCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return STT_LANGUAGE_ALIASES[normalized] ?? normalized;
}

export const DEFAULT_STT_TURN_CONFIG: SttTurnConfig = {
  // 120 ms séparait trop souvent une phrase sur une micro-pause naturelle.
  // Une pause téléphonique de 220 ms reste réactive tout en laissant Scribe
  // stabiliser « on sera quatre personnes » en un seul segment.
  vadSilenceThresholdSecs: 0.95,
  minSpeechDurationMs: 80,
  minSilenceDurationMs: 220,
};

/**
 * Scribe ne permet pas de modifier la VAD sur une socket active. Ce profil
 * est conservé pour la prochaine connexion et la grâce côté application.
 */
export const SPELLING_STT_TURN_CONFIG: SttTurnConfig = {
  vadSilenceThresholdSecs: 1.2,
  minSpeechDurationMs: 80,
  minSilenceDurationMs: 180,
};
export const STT_SPELLING_EOT_GRACE_MS = 650;
export const STT_AUDIO_BUFFER_MAX = 400;

const RESERVATION_KEYTERMS = [
  // Français
  'réservation',
  'réserver',
  'personnes',
  'soir',
  'heures',
  'midi',
  'couverts',
  'deux',
  'double',
  'épeler',
  'au nom de',
  'demain',
  'aujourd’hui',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  // Anglais
  'reservation',
  'reserve',
  'table',
  'people',
  'tonight',
  'tomorrow',
  'booking',
  'dinner',
  'lunch',
  // Espagnol
  'reserva',
  'reservar',
  'mesa',
  'personas',
  // Italien
  'prenotazione',
  'prenotare',
  'tavolo',
  'persone',
  'domani',
  // Allemand
  'reservierung',
  'reservieren',
  'tisch',
  'morgen',
  // Portugais
  'pessoas',
  'amanhã',
  // Néerlandais
  'reservering',
  'reserveren',
  'tafel',
];
const MAX_STT_KEYTERMS = 50;
const MAX_TURN_PARTIALS = 30;
const MAX_STT_KEYTERM_LENGTH = 20;
const MAX_STT_PREVIOUS_TEXT_LENGTH = 50;
/** Délai de repli si Scribe n'envoie pas le commit horodaté attendu. */
export const STT_TIMESTAMPED_COMMIT_GRACE_MS = 250;

/**
 * Lit la liste CSV des langues Scribe autorisées. Les codes ISO-639-1 et
 * ISO-639-3 sont acceptés par ElevenLabs ; les valeurs invalides sont
 * ignorées afin de conserver une poignée de main valide.
 */
export function getSttLanguageCodes(): string[] {
  if (process.env.ELEVENLABS_STT_ALL_LANGUAGES === 'true') {
    return [...ALL_STT_LANGUAGES];
  }
  const configured = process.env.ELEVENLABS_STT_LANGUAGES;
  const candidates = configured
    ? configured.split(',').map(normalizeSttLanguageCode)
    : [...DEFAULT_STT_LANGUAGES];
  const languages = candidates.filter((value) => STT_LANGUAGE_CODE_PATTERN.test(value));
  return [...new Set(languages.length ? languages : DEFAULT_STT_LANGUAGES)];
}

/**
 * Construit les termes Scribe pour un restaurant donné. Les termes Realtime
 * sont limités à 20 caractères et 50 valeurs ; les valeurs invalides sont
 * ignorées afin de ne jamais rendre la poignée de main provider invalide.
 */
export function buildSttKeyterms(
  restaurantName?: string,
  additionalKeyterms: readonly string[] = [],
): string[] {
  // Les termes propres au restaurant sont prioritaires ; les 50 slots Scribe
  // ne doivent pas être consommés par le vocabulaire générique multilingue.
  const candidates = [restaurantName ?? '', ...additionalKeyterms, ...RESERVATION_KEYTERMS];
  const keyterms: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = candidate.trim().replace(/\s+/gu, ' ');
    if (!normalized) continue;

    // Un nom long est plus utile sous forme de mots que tronqué au milieu.
    const values =
      normalized.length <= MAX_STT_KEYTERM_LENGTH
        ? [normalized]
        : normalized.split(' ').filter((word) => word.length <= MAX_STT_KEYTERM_LENGTH);

    for (const value of values) {
      const dedupeKey = value.toLocaleLowerCase('fr-FR');
      if (!value || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      keyterms.push(value);
      if (keyterms.length >= MAX_STT_KEYTERMS) return keyterms;
    }
  }

  return keyterms;
}

/** Contexte court envoyé à Scribe uniquement avec le premier paquet audio. */
export function buildSttPreviousText(restaurantName?: string): string {
  const name = restaurantName?.trim().replace(/\s+/gu, ' ');
  const context = name
    ? `Réservation / restaurant booking ${name}`
    : 'Réservation / restaurant booking';
  return Array.from(context).slice(0, MAX_STT_PREVIOUS_TEXT_LENGTH).join('');
}

function writeDebugLog(msg: string, err?: unknown): void {
  const e = err instanceof Error ? err : err ? new Error(String(err)) : undefined;
  const timestamp = new Date().toISOString();
  const logMsg =
    '[' + timestamp + '] ' + msg + (e ? ' | ERROR: ' + e.message + '\n' + e.stack : '') + '\n';
  try {
    const logPath =
      process.env.DEBUG_LOG_PATH || path.join(process.cwd(), 'scratch', 'call_debug.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logMsg);
  } catch (writeError) {
    logger.error({ err: writeError }, 'Failed to write debug log');
  }
}

function readConfiguredNumber(envName: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Silence Scribe par défaut quand la fin de tour hybride est active. */
export const SMART_ENDPOINT_VAD_SILENCE_SECS = 0.5;

/**
 * Fin de tour hybride : Scribe commite après un silence court et
 * l'application décide d'attendre ou non selon la phrase. Activée par
 * VOICE_SMART_ENDPOINT_ENABLED, limitée à VOICE_SMART_ENDPOINT_RESTAURANT_IDS
 * quand la liste est renseignée.
 */
export function isSmartEndpointEnabled(session: Pick<CallSession, 'restaurantId'>): boolean {
  if (process.env.VOICE_SMART_ENDPOINT_ENABLED !== 'true') return false;
  const restaurantIds = (process.env.VOICE_SMART_ENDPOINT_RESTAURANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return restaurantIds.length === 0 || restaurantIds.includes(session.restaurantId);
}

function getBaseSttTurnConfig(smartEndpoint = false): SttTurnConfig {
  return {
    vadSilenceThresholdSecs: smartEndpoint
      ? readConfiguredNumber(
          'VOICE_SMART_ENDPOINT_VAD_SILENCE_SECS',
          SMART_ENDPOINT_VAD_SILENCE_SECS,
          0.2,
          3,
        )
      : readConfiguredNumber(
          'ELEVENLABS_STT_VAD_SILENCE_SECS',
          DEFAULT_STT_TURN_CONFIG.vadSilenceThresholdSecs,
          0.2,
          3,
        ),
    minSpeechDurationMs: readConfiguredNumber(
      'ELEVENLABS_STT_MIN_SPEECH_MS',
      DEFAULT_STT_TURN_CONFIG.minSpeechDurationMs,
      40,
      1_000,
    ),
    minSilenceDurationMs: readConfiguredNumber(
      'ELEVENLABS_STT_MIN_SILENCE_MS',
      DEFAULT_STT_TURN_CONFIG.minSilenceDurationMs,
      40,
      1_000,
    ),
  };
}

function cloneSttTurnConfig(config: SttTurnConfig): SttTurnConfig {
  return { ...config };
}

function ensureSttTurnConfig(session: CallSession): NonNullable<CallSession['sttTurnConfig']> {
  if (!session.sttTurnConfig) {
    const base = getBaseSttTurnConfig(isSmartEndpointEnabled(session));
    session.sttTurnConfig = {
      base,
      desired: cloneSttTurnConfig(base),
      applied: null,
      spellingActive: false,
      previous: null,
    };
  }
  return session.sttTurnConfig;
}

function configuredModel(session: CallSession): string {
  return session.sttModel ?? process.env.ELEVENLABS_STT_MODEL ?? DEFAULT_STT_MODEL;
}

function getSttHost(): string {
  return process.env.ELEVENLABS_STT_HOST ?? 'api.elevenlabs.io';
}

/** Format audio Scribe correspondant au codec Telnyx entrant. */
export function sttAudioFormatForCodec(
  codec: CallSession['codec'],
): 'ulaw_8000' | 'pcm_8000' | 'pcm_16000' {
  if (codec === 'PCMU') return 'ulaw_8000';
  // L16 arrive en PCM16 16 kHz, déjà dans le format attendu par Scribe.
  return codec === 'L16' ? 'pcm_16000' : 'pcm_8000';
}

/**
 * Construit l'URL Scribe Realtime. PCMU est envoyé directement en ulaw_8000.
 * PCMA est converti en PCM16 avant émission et utilise pcm_8000. L16 est du
 * PCM16 16 kHz et utilise pcm_16000, sans décodage.
 */
export function buildSttUrl(
  model: string = DEFAULT_STT_MODEL,
  codec: 'PCMA' | 'PCMU' | 'L16' = 'PCMU',
  turnConfig: SttTurnConfig = getBaseSttTurnConfig(),
  options: {
    restaurantName?: string;
    keyterms?: readonly string[];
    languages?: readonly string[];
    filterBackgroundAudio?: boolean;
    forceFrench?: boolean;
  } = {},
): string {
  const params = new URLSearchParams({
    model_id: model,
    audio_format: sttAudioFormatForCodec(codec),
    commit_strategy: 'vad',
    vad_silence_threshold_secs: String(turnConfig.vadSilenceThresholdSecs),
    vad_threshold: '0.4',
    min_speech_duration_ms: String(turnConfig.minSpeechDurationMs),
    min_silence_duration_ms: String(turnConfig.minSilenceDurationMs),
    // Scribe rejects `filter_background_audio` together with `include_timestamps`.
    ...(!options.filterBackgroundAudio ? { include_timestamps: 'true' } : {}),
    include_language_detection: options.forceFrench ? 'false' : 'true',
  });

  if (options.forceFrench) {
    params.set('language_code', 'fr');
  } else {
    for (const language of options.languages ?? getSttLanguageCodes()) {
      const normalized = normalizeSttLanguageCode(language);
      if (STT_LANGUAGE_CODE_PATTERN.test(normalized)) {
        params.append('secondary_languages', normalized);
      }
    }
  }
  if (options.filterBackgroundAudio) params.set('filter_background_audio', 'true');
  for (const keyterm of buildSttKeyterms(options.restaurantName, options.keyterms)) {
    params.append('keyterms', keyterm);
  }
  return 'wss://' + getSttHost() + STT_REALTIME_PATH + '?' + params.toString();
}

export const DEEPGRAM_ENDPOINTING_MS = 700;
export const DEEPGRAM_UTTERANCE_END_MS = 1_000;

export function buildDeepgramSttUrl(
  codec: CallSession['codec'],
  keyterms: readonly string[] = buildSttKeyterms(),
): string {
  const encoding = codec === 'PCMA' ? 'alaw' : codec === 'PCMU' ? 'mulaw' : 'linear16';
  const sampleRate = codec === 'L16' ? 16000 : 8000;
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'fr',
    encoding,
    sample_rate: String(sampleRate),
    interim_results: 'true',
    endpointing: String(DEEPGRAM_ENDPOINTING_MS),
    utterance_end_ms: String(DEEPGRAM_UTTERANCE_END_MS),
    vad_events: 'true',
    smart_format: 'false',
    numerals: 'true',
  });
  for (const keyterm of keyterms) params.append('keyterm', keyterm);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function createSttAdapter(session: CallSession, provider: SttProviderId): SttProviderAdapter {
  return provider === 'deepgram'
    ? createDeepgramSttAdapter({ model: 'nova-3' })
    : createScribeSttAdapter({ model: configuredModel(session) });
}

function sttAdapterForSession(session: CallSession): SttProviderAdapter {
  return (session.sttAdapter ??= createSttAdapter(
    session,
    resolveVoiceFeatureSnapshot(session).sttProvider,
  ));
}

interface SttTurnTiming {
  speechEndAt?: number;
  sttFinalAt?: number;
}

function metricProvider(session: CallSession): SttProviderAdapter['metricLabel'] {
  return sttAdapterForSession(session).metricLabel;
}

function sttTimingFromOffset(session: CallSession, offsetMs?: number): SttTurnTiming {
  const sttFinalAt = Date.now();
  // Provider offsets anchor to the audio queued at socket open; without one,
  // the latest non-empty partial is the closest available end-of-speech proxy.
  const mappedSpeechEnd =
    offsetMs !== undefined && session.sttConnectionAudioStartedAt !== undefined
      ? Math.min(sttFinalAt, session.sttConnectionAudioStartedAt + offsetMs)
      : undefined;
  const speechEndAt =
    mappedSpeechEnd ?? session.sttLastNonEmptyPartialAt ?? session.sttLastSpeechStartedAt;
  return { ...(speechEndAt !== undefined ? { speechEndAt } : {}), sttFinalAt };
}

function mergeSttTiming(previous?: SttTurnTiming, next?: SttTurnTiming): SttTurnTiming | undefined {
  if (!previous && !next) return undefined;
  return {
    ...(previous ?? {}),
    ...(next ?? {}),
  };
}

/**
 * Scribe ne propose pas de reconfiguration sur une socket active. On mémorise
 * le profil métier pour une prochaine connexion et pour la grâce de fin de tour.
 */
export function setSttSpellingProfile(session: CallSession, active: boolean): void {
  // Changement d'état du pipeline de fin de tour : on ne garde pas d'audio en
  // attente, sinon il serait attribué à un profil VAD qui n'est plus le bon.
  flushSttChunkBuffer(session);
  const state = ensureSttTurnConfig(session);
  if (active && !state.spellingActive) {
    state.previous = cloneSttTurnConfig(state.applied ?? state.base);
  }
  state.spellingActive = active;
  state.desired = cloneSttTurnConfig(
    active ? SPELLING_STT_TURN_CONFIG : (state.previous ?? state.base),
  );
  if (!active) state.previous = null;
}

function clearPendingSttEndOfTurn(session: CallSession): void {
  if (session.sttEndOfTurnTimer) {
    clearTimeout(session.sttEndOfTurnTimer);
    session.sttEndOfTurnTimer = null;
  }
  session.pendingSttEndOfTurn = null;
}

function transcriptWords(transcript: string): string[] {
  return transcript.trim().split(/\s+/u).filter(Boolean);
}

function mergeSttTranscripts(previous: string, next: string): string {
  const previousWords = transcriptWords(previous);
  const nextWords = transcriptWords(next);
  if (previousWords.length === 0) return next.trim();
  if (nextWords.length === 0) return previous.trim();

  const normalizeWord = (word: string) => word.toLocaleLowerCase('fr-FR');
  const previousNormalized = previousWords.map(normalizeWord);
  const nextNormalized = nextWords.map(normalizeWord);
  const startsWith = (full: string[], prefix: string[]) =>
    prefix.length <= full.length && prefix.every((word, index) => full[index] === word);

  if (startsWith(nextNormalized, previousNormalized)) return next.trim();
  if (startsWith(previousNormalized, nextNormalized)) return previous.trim();

  const maxOverlap = Math.min(previousWords.length, nextWords.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const previousSuffix = previousNormalized.slice(previousWords.length - overlap);
    const nextPrefix = nextNormalized.slice(0, overlap);
    if (previousSuffix.every((word, index) => word === nextPrefix[index])) {
      return [...previousWords, ...nextWords.slice(overlap)].join(' ');
    }
  }
  return [...previousWords, ...nextWords].join(' ');
}

function mergeIncompleteDialogueTranscript(previous: string, next: string): string {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr-FR')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const previousWords = transcriptWords(previous);
  const nextWords = transcriptWords(next);
  const previousNormalized = previousWords.map(normalize);
  const nextNormalized = nextWords.map(normalize);
  if (
    previousNormalized.length <= nextNormalized.length &&
    previousNormalized.every((word, index) => word === nextNormalized[index])
  ) {
    return next.trim();
  }
  if (
    nextNormalized.length <= previousNormalized.length &&
    nextNormalized.every((word, index) => word === previousNormalized[index])
  ) {
    return previous.trim();
  }
  return mergeSttTranscripts(previous, next);
}

function clearSemanticHold(
  session: CallSession,
): NonNullable<CallSession['sttSemanticHold']> | null {
  const hold = session.sttSemanticHold ?? null;
  if (hold?.timer) clearTimeout(hold.timer);
  session.sttSemanticHold = null;
  return hold;
}

function holdIncompleteDialogueTranscript(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
  timing?: SttTurnTiming,
): void {
  const previous = clearSemanticHold(session);
  const mergedWords =
    previous?.words || words ? [...(previous?.words ?? []), ...(words ?? [])] : undefined;
  const hold = {
    transcript: previous
      ? mergeIncompleteDialogueTranscript(previous.transcript, transcript)
      : transcript,
    ...(mergedWords ? { words: mergedWords } : {}),
    ...((languageCode ?? previous?.languageCode)
      ? { languageCode: languageCode ?? previous?.languageCode }
      : {}),
    ...(mergeSttTiming(previous?.timing, timing)
      ? { timing: mergeSttTiming(previous?.timing, timing) }
      : {}),
    holdMs: DIALOGUE_V2_INCOMPLETE_HOLD_MS,
    timer: null,
  };
  session.sttSemanticHold = hold;
  logger.debug(
    { callId: session.callControlId, holdMs: hold.holdMs, reason: 'incomplete_dialogue_turn' },
    '[stt] Holding incomplete dialogue turn',
  );
  armSemanticHoldTimer(session, hold);
}

function armSemanticHoldTimer(
  session: CallSession,
  hold: NonNullable<CallSession['sttSemanticHold']>,
): void {
  if (hold.timer) clearTimeout(hold.timer);
  hold.timer = setTimeout(() => {
    if (session.sttSemanticHold !== hold) return;
    session.sttSemanticHold = null;
    dispatchUtteranceEnd(session, hold.transcript, hold.words, hold.languageCode, hold.timing);
  }, hold.holdMs);
}

/**
 * Fin de tour hybride : après le commit Scribe, attend un délai variable
 * selon la phrase. Si le client reprend pendant l'attente, la suite est
 * fusionnée au texte retenu au lieu de créer un second tour.
 */
function dispatchOrHoldUtteranceEnd(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
  timing?: SttTurnTiming,
): void {
  // Fin de tour détectée : vider le tampon pour que Scribe ait vu tout l'audio
  // avant que le tour soit traité.
  flushSttChunkBuffer(session);
  const previous = clearSemanticHold(session);
  const merged = previous
    ? isVoiceDialogueIncompleteTranscript(previous.transcript)
      ? mergeIncompleteDialogueTranscript(previous.transcript, transcript)
      : mergeSttTranscripts(previous.transcript, transcript)
    : transcript;
  const mergedWords = previous?.words && words ? [...previous.words, ...words] : words;
  const mergedLanguage = languageCode ?? previous?.languageCode;
  const mergedTiming = mergeSttTiming(previous?.timing, timing);

  const { holdMs, reason } = getSmartEndpointDelay(merged);
  if (holdMs === 0) {
    dispatchUtteranceEnd(session, merged, mergedWords, mergedLanguage, mergedTiming);
    return;
  }

  logger.debug({ callId: session.callControlId, reason, holdMs }, '[stt] Holding end of turn');
  const hold: NonNullable<CallSession['sttSemanticHold']> = {
    transcript: merged,
    ...(mergedWords ? { words: mergedWords } : {}),
    ...(mergedLanguage ? { languageCode: mergedLanguage } : {}),
    ...(mergedTiming ? { timing: mergedTiming } : {}),
    holdMs,
    timer: null,
  };
  session.sttSemanticHold = hold;
  armSemanticHoldTimer(session, hold);
}

function dispatchUtteranceEnd(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
  timing?: SttTurnTiming,
): void {
  flushSttChunkBuffer(session);
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;
  if (languageCode) session.sttLanguageCode = languageCode;
  const sttFinalAt = timing?.sttFinalAt ?? Date.now();
  const speechEndAt = timing?.speechEndAt ?? session.sttLastNonEmptyPartialAt;
  const turnDispatchedAt = Date.now();
  logger.info(
    {
      callId: session.callControlId,
      ...describeTranscript(cleanTranscript),
      ...(languageCode ? { languageCode } : {}),
    },
    '[stt] End of turn',
  );
  session.onSttEvent?.({
    type: 'UtteranceEnd',
    transcript: cleanTranscript,
    ...(words ? { words } : {}),
    ...(languageCode ? { languageCode } : {}),
    ...(speechEndAt !== undefined ? { speechEndAt } : {}),
    sttFinalAt,
    turnDispatchedAt,
  });
  session.sttLastNonEmptyPartialAt = undefined;
  session.sttLastSpeechStartedAt = undefined;
}

function schedulePendingSttEndOfTurn(session: CallSession): void {
  if (session.sttEndOfTurnTimer) clearTimeout(session.sttEndOfTurnTimer);
  session.sttEndOfTurnTimer = setTimeout(() => {
    const pending = session.pendingSttEndOfTurn;
    session.pendingSttEndOfTurn = null;
    session.sttEndOfTurnTimer = null;
    if (pending)
      dispatchUtteranceEnd(
        session,
        pending.transcript,
        pending.words,
        pending.languageCode,
        pending.timing,
      );
  }, STT_SPELLING_EOT_GRACE_MS);
}

function flushPendingSttEndOfTurn(session: CallSession): void {
  const pending = session.pendingSttEndOfTurn;
  if (!pending) return;
  if (session.sttEndOfTurnTimer) {
    clearTimeout(session.sttEndOfTurnTimer);
    session.sttEndOfTurnTimer = null;
  }
  session.pendingSttEndOfTurn = null;
  dispatchUtteranceEnd(
    session,
    pending.transcript,
    pending.words,
    pending.languageCode,
    pending.timing,
  );
}

function sendSessionAudioChunk(session: CallSession, telnyxAudio: Buffer): void {
  if (!session.sttWs) return;
  const adapter = sttAdapterForSession(session);
  const audio = adapter.toProviderAudio(session.codec, telnyxAudio);
  const isFirstChunk = !session.sttFirstAudioChunkSent;
  adapter.sendAudio(
    session.sttWs,
    audio,
    isFirstChunk && adapter.id === 'scribe'
      ? buildSttPreviousText(session.restaurantName)
      : undefined,
  );
  addSttAudioSamples(session, adapter.samplesForAudio(session.codec, audio.length));
  session.sttFirstAudioChunkSent = true;
  const chunkMs = String(getSttChunkMs());
  voiceSttProviderAudioMessagesTotal.inc({ provider: adapter.id, chunk_ms: chunkMs });
  voiceSttProviderChunkBytes.observe({ provider: adapter.id }, audio.length);
  if (adapter.id === 'scribe') {
    voiceSttAudioMessagesTotal.inc({ chunk_ms: chunkMs });
    voiceSttChunkBytes.observe(audio.length);
  }
}

function clearSttChunkTimer(session: CallSession): void {
  if (session.sttChunkTimer) {
    clearTimeout(session.sttChunkTimer);
    session.sttChunkTimer = null;
  }
}

/**
 * Envoie le tampon de regroupement s'il reste des octets. Idempotent : appelé
 * avant chaque étape qui ne doit pas laisser d'audio en attente (commit manuel,
 * fin de tour, barge-in, fermeture, reconnexion, fin d'appel).
 */
export function flushSttChunkBuffer(session: CallSession): void {
  clearSttChunkTimer(session);
  const buffered = session.sttChunkBuffer;
  session.sttChunkBuffer = null;
  if (buffered && buffered.length > 0) deliverSttAudio(session, buffered);
}

/** Envoie dès que la socket est ouverte, sinon met en file pour la reconnexion. */
function deliverSttAudio(session: CallSession, audio: Buffer): void {
  if (session.sttWs?.readyState === WebSocket.OPEN) {
    sendSessionAudioChunk(session, audio);
    return;
  }
  if (
    session.audioBuffer.length >= STT_AUDIO_BUFFER_MAX &&
    !(process.env.VOICE_STT_LANGUAGE_LOCK === 'true' && session.languageLocked === 'fr')
  )
    session.audioBuffer.shift();
  session.audioBuffer.push(audio);
}

function appendSttChunk(session: CallSession, input: Buffer, chunkMs: number): void {
  const accumulated = session.sttChunkBuffer
    ? Buffer.concat([session.sttChunkBuffer, input])
    : input;
  const targetBytes = chunkMs * telnyxBytesPerMs(session.codec);
  if (accumulated.length >= targetBytes) {
    clearSttChunkTimer(session);
    session.sttChunkBuffer = null;
    deliverSttAudio(session, accumulated);
    return;
  }
  session.sttChunkBuffer = accumulated;
  if (!session.sttChunkTimer) {
    // Le flux peut s'interrompre avant que le tampon soit plein : on l'envoie
    // quand même après la durée cible + 20 ms.
    session.sttChunkTimer = setTimeout(() => {
      session.sttChunkTimer = null;
      flushSttChunkBuffer(session);
    }, chunkMs + STT_CHUNK_SAFETY_EXTRA_MS);
  }
}

/**
 * À l'ouverture de la socket : rejoue d'abord la file de reconnexion (trames
 * les plus anciennes), puis le tampon partiel courant, pour ne rien perdre ni
 * réordonner.
 */
export function resumeSttAfterOpen(session: CallSession): void {
  for (const chunk of session.audioBuffer) sendSessionAudioChunk(session, chunk);
  session.audioBuffer = [];
  flushSttChunkBuffer(session);
}

export interface ElevenLabsSttMessage {
  message_type?: string;
  text?: string;
  error?: string;
  message?: string;
  warning?: string;
  language_code?: string;
  entities?: Array<{
    text?: string;
    type?: string;
    start?: number;
    end?: number;
  }>;
  words?: Array<{
    word?: string;
    text?: string;
    start?: number;
    end?: number;
    confidence?: number;
    /** Scribe Realtime envoie une log-probabilité, pas une confiance. */
    logprob?: number;
    type?: string;
  }>;
}

const SAFE_STT_PROVIDER_ERROR_TYPES = new Set([
  'auth_error',
  'quota_exceeded',
  'transcriber_error',
  'input_error',
  'invalid_request',
  'error',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'chunk_size_exceeded',
  'insufficient_audio_activity',
  'scribe_error',
]);

function sttErrorMetricType(messageType: string | undefined): string {
  if (!messageType) return 'provider_error';
  if (/auth/iu.test(messageType)) return 'auth';
  if (/quota/iu.test(messageType)) return 'quota';
  if (/terms/iu.test(messageType)) return 'terms';
  if (/rate|throttl/iu.test(messageType)) return 'rate_limited';
  if (/queue|resource/iu.test(messageType)) return 'capacity';
  if (/session_time/iu.test(messageType)) return 'session_limit';
  if (/input|chunk/iu.test(messageType)) return 'input';
  if (/invalid/iu.test(messageType)) return 'invalid_request';
  return 'provider_error';
}

function clearPendingSttCommit(session: CallSession): CallSession['sttPendingCommit'] {
  const pending = session.sttPendingCommit;
  if (pending?.timer) clearTimeout(pending.timer);
  session.sttPendingCommit = null;
  return pending;
}

function sameTranscript(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('fr-FR') === right.trim().toLocaleLowerCase('fr-FR');
}

/** Un commit terminé par une ellipse est un fragment, pas un tour exploitable. */
export function isLikelyIncompleteTranscript(transcript: string): boolean {
  return /(?:\.\.\.|…)\s*$/u.test(transcript.trim());
}

/**
 * Les marqueurs de ponctuation isolés sont parfois émis par le VAD au début
 * d'un appel. Ils ne peuvent pas constituer une prise de parole exploitable.
 */
export function isPunctuationOnlyTranscript(transcript: string): boolean {
  const normalized = transcript.trim();
  return Boolean(normalized) && !/[\p{L}\p{N}]/u.test(normalized);
}

/**
 * Détecte les répétitions qui proviennent souvent d'un écho acoustique ou
 * d'un bruit téléphonique. Les mots d'interruption (« non », « stop », ...)
 * restent autorisés afin de préserver le barge-in volontaire.
 */
export function isLikelyRepeatedNoiseTranscript(transcript: string): boolean {
  const words = transcript
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length < 3) return false;

  const interruptionWords = new Set(['non', 'no', 'stop', 'attends', 'attendez', 'wait']);
  const noiseWords = new Set(['ah', 'euh', 'heu', 'hum', 'hmm', 'oh', 'waouh', 'wow']);
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const [topWord, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return Boolean(
    topWord &&
    topCount >= 3 &&
    topCount / words.length >= 0.6 &&
    noiseWords.has(topWord) &&
    !interruptionWords.has(topWord),
  );
}

function lowSignalTranscriptReason(
  transcript: string,
): 'incomplete' | 'repetition' | 'punctuation' | null {
  if (isPunctuationOnlyTranscript(transcript)) return 'punctuation';
  if (isLikelyIncompleteTranscript(transcript)) return 'incomplete';
  if (isLikelyRepeatedNoiseTranscript(transcript)) return 'repetition';
  return null;
}

/**
 * L'API peut envoyer un commit stable puis son événement horodaté. On attend
 * brièvement le second pour ne pas déclencher deux tours LLM pour une seule
 * phrase, tout en gardant un repli si l'événement horodaté manque.
 */
function queuePlainCommittedTranscript(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
  timing?: SttTurnTiming,
): void {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;

  const previous = clearPendingSttCommit(session);
  if (previous)
    dispatchCommittedTranscript(
      session,
      previous.transcript,
      previous.words,
      previous.languageCode,
      previous.timing,
    );
  // Le commit clôt ce segment même si l'événement horodaté arrive quelques
  // millisecondes plus tard ; un nouveau partial doit démarrer un tour neuf.
  session.turnTranscript = '';

  const timer = setTimeout(() => {
    const pending = session.sttPendingCommit;
    if (!pending) return;
    session.sttPendingCommit = null;
    dispatchCommittedTranscript(
      session,
      pending.transcript,
      pending.words,
      pending.languageCode,
      pending.timing,
    );
  }, STT_TIMESTAMPED_COMMIT_GRACE_MS);
  session.sttPendingCommit = {
    transcript: cleanTranscript,
    ...(words ? { words } : {}),
    ...(languageCode ? { languageCode } : {}),
    ...(timing ? { timing } : {}),
    timer,
  };
}

function dispatchTimestampedCommittedTranscript(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
  timing?: SttTurnTiming,
): void {
  const pending = session.sttPendingCommit;
  if (pending && (!transcript.trim() || sameTranscript(pending.transcript, transcript))) {
    clearPendingSttCommit(session);
    dispatchCommittedTranscript(
      session,
      transcript.trim() || pending.transcript,
      words ?? pending.words,
      languageCode ?? pending.languageCode,
      mergeSttTiming(pending.timing, timing),
    );
    return;
  }
  if (pending) {
    clearPendingSttCommit(session);
    dispatchCommittedTranscript(
      session,
      pending.transcript,
      pending.words,
      pending.languageCode,
      pending.timing,
    );
  }
  dispatchCommittedTranscript(session, transcript, words, languageCode, timing);
}

function handleBargeInFromTranscript(
  session: CallSession,
  mgr: CallSessionManager,
  transcript: string,
): void {
  if (session.state !== 'SPEAKING' || !transcript.trim()) return;
  const lowSignalReason = lowSignalTranscriptReason(transcript);
  if (lowSignalReason) {
    logger.debug(
      {
        callId: session.callControlId,
        reason: lowSignalReason,
        transcriptLength: transcript.trim().length,
      },
      '[barge-in] Ignoring low-signal transcript',
    );
    return;
  }
  logger.info(
    { callId: session.callControlId, ...describeTranscript(transcript.trim()) },
    '[barge-in] User spoke while assistant was speaking. Interrupting.',
  );
  // Un barge-in coupe le TTS : l'audio déjà capté doit partir maintenant,
  // sinon il resterait dans le tampon de regroupement.
  flushSttChunkBuffer(session);
  session.abortController?.abort();
  session.abortController = null;
  mgr.handleBargeIn(session);
}

function emitPartialTranscript(session: CallSession, transcript: string): void {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;

  if (
    resolveVoiceFeatureSnapshot(session).dialogueListeningV2Enabled &&
    isVoiceDialogueIncompleteTranscript(cleanTranscript)
  ) {
    handleBargeInFromTranscript(session, CallSessionManager.getInstance(), cleanTranscript);
    const hold = session.sttSemanticHold;
    if (hold) {
      if (hold.timer) clearTimeout(hold.timer);
      hold.timer = null;
      hold.transcript = mergeIncompleteDialogueTranscript(hold.transcript, cleanTranscript);
      hold.holdMs = DIALOGUE_V2_INCOMPLETE_HOLD_MS;
      armSemanticHoldTimer(session, hold);
    }
    session.turnTranscript = mergeSttTranscripts(session.turnTranscript, cleanTranscript);
    return;
  }

  const lowSignalReason = lowSignalTranscriptReason(cleanTranscript);
  if (lowSignalReason) {
    // Conserver le texte pour que le commit stable suivant puisse le remplacer,
    // sans déclencher d'interruption ou de LLM spéculatif sur le fragment.
    if (lowSignalReason === 'incomplete') {
      session.turnTranscript = mergeSttTranscripts(session.turnTranscript, cleanTranscript);
    }
    return;
  }

  const mgr = CallSessionManager.getInstance();
  handleBargeInFromTranscript(session, mgr, cleanTranscript);

  const semanticHold = session.sttSemanticHold;
  if (semanticHold?.timer) {
    // Le client reprend sa phrase : le tour retenu reste ouvert jusqu'au
    // prochain commit, qui le fusionnera.
    clearTimeout(semanticHold.timer);
    semanticHold.timer = null;
  }

  if (!session.turnTranscript.trim() && !semanticHold) {
    flushPendingSttEndOfTurn(session);
    session.turnPartials = [];
    session.onSttEvent?.({ type: 'UtteranceStart' });
  } else if (session.state === 'PROCESSING' && cleanTranscript !== session.turnTranscript) {
    session.onSttEvent?.({ type: 'SpeechResumed' });
  }

  session.turnTranscript = mergeSttTranscripts(session.turnTranscript, cleanTranscript);
  // Partielles bornées : elles servent à voir si une valeur a changé en cours de tour.
  const partials = (session.turnPartials ??= []);
  if (partials.at(-1) !== cleanTranscript) partials.push(cleanTranscript);
  if (partials.length > MAX_TURN_PARTIALS) partials.splice(0, partials.length - MAX_TURN_PARTIALS);

  const wordCount = cleanTranscript.split(/\s+/u).filter(Boolean).length;
  const isSpeculativeEnabled = isSpeculativeLlmEnabled(session);
  if (
    isSpeculativeEnabled &&
    !isNameCollectionBlocking(session) &&
    session.conversation?.pendingQuestion !== 'customerName' &&
    wordCount >= 3 &&
    wordCount <= 20 &&
    cleanTranscript !== session.speculativeTranscript
  ) {
    session.speculativeTranscript = cleanTranscript;
    session.onSttEvent?.({ type: 'InterimHighConfidence', transcript: cleanTranscript });
  }
}

function dispatchCommittedTranscript(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
  timing?: SttTurnTiming,
): void {
  const cleanTranscript = transcript.trim() || session.turnTranscript.trim();
  session.turnTranscript = '';
  if (!cleanTranscript) return;

  if (
    resolveVoiceFeatureSnapshot(session).dialogueListeningV2Enabled &&
    isVoiceDialogueIncompleteTranscript(cleanTranscript)
  ) {
    handleBargeInFromTranscript(session, CallSessionManager.getInstance(), cleanTranscript);
    holdIncompleteDialogueTranscript(session, cleanTranscript, words, languageCode, timing);
    return;
  }

  const lowSignalReason = lowSignalTranscriptReason(cleanTranscript);
  if (lowSignalReason) {
    logger.info(
      {
        callId: session.callControlId,
        reason: lowSignalReason,
        transcriptLength: cleanTranscript.length,
      },
      '[stt] Ignoring low-signal committed transcript',
    );
    // Un tour retenu ne doit jamais rester bloqué derrière un commit ignoré.
    const hold = session.sttSemanticHold;
    if (hold && !hold.timer) armSemanticHoldTimer(session, hold);
    return;
  }

  // Le partial est normalement le premier signal de barge-in, mais Scribe
  // peut engager un transcript sans partial observable sur une connexion
  // courte. Le commit doit donc rester suffisant pour interrompre le TTS.
  handleBargeInFromTranscript(session, CallSessionManager.getInstance(), cleanTranscript);

  const spellingProfileActive =
    isNameCollectionBlocking(session) || session.conversation.pendingQuestion === 'customerName';
  if (spellingProfileActive) {
    session.pendingSttEndOfTurn = {
      transcript: cleanTranscript,
      ...(words ? { words } : {}),
      ...(languageCode ? { languageCode } : {}),
      ...(timing ? { timing } : {}),
    };
    schedulePendingSttEndOfTurn(session);
    return;
  }
  if (
    isSmartEndpointEnabled(session) ||
    resolveVoiceFeatureSnapshot(session).dialogueListeningV2Enabled
  ) {
    dispatchOrHoldUtteranceEnd(session, cleanTranscript, words, languageCode, timing);
    return;
  }
  dispatchUtteranceEnd(session, cleanTranscript, words, languageCode, timing);
}

function dispatchDeepgramFinalParts(session: CallSession): void {
  const parts = session.sttDeepgramFinalParts ?? [];
  session.sttDeepgramFinalParts = [];
  const transcript = parts.reduce(
    (merged, part) => mergeSttTranscripts(merged, part.transcript),
    '',
  );
  if (!transcript.trim()) return;
  const words = parts.flatMap((part) => part.words ?? []);
  const speechEndOffsetMs = parts.reduce(
    (latest, part) => Math.max(latest, part.speechEndOffsetMs ?? 0),
    0,
  );
  const languageCode = [...parts].reverse().find((part) => part.languageCode)?.languageCode ?? 'fr';
  const timing = sttTimingFromOffset(session, speechEndOffsetMs || undefined);
  dispatchCommittedTranscript(
    session,
    transcript,
    words.length ? words : undefined,
    languageCode,
    timing,
  );
}

function handleNormalizedSttMessage(
  session: CallSession,
  event: NormalizedSttProviderMessage,
): void {
  switch (event.type) {
    case 'session_started':
      if (metricProvider(session) === 'elevenlabs_stt') {
        logger.info({ callId: session.callControlId }, '[stt] ElevenLabs Scribe session started');
      }
      return;
    case 'partial':
      if (event.transcript.trim()) {
        session.sttConsecutiveFailures = 0;
        session.sttLastNonEmptyPartialAt = Date.now();
      }
      emitPartialTranscript(session, event.transcript);
      return;
    case 'plain_commit':
      if (event.transcript.trim()) session.sttConsecutiveFailures = 0;
      queuePlainCommittedTranscript(
        session,
        event.transcript,
        event.words,
        event.languageCode,
        sttTimingFromOffset(session, event.speechEndOffsetMs),
      );
      return;
    case 'timestamped_commit':
      if (event.transcript.trim()) session.sttConsecutiveFailures = 0;
      dispatchTimestampedCommittedTranscript(
        session,
        event.transcript,
        event.words,
        event.languageCode,
        sttTimingFromOffset(session, event.speechEndOffsetMs),
      );
      return;
    case 'final_segment': {
      const parts = (session.sttDeepgramFinalParts ??= []);
      if (event.transcript.trim()) {
        parts.push({
          transcript: event.transcript,
          ...(event.words ? { words: event.words } : {}),
          ...(event.languageCode ? { languageCode: event.languageCode } : {}),
          ...(event.speechEndOffsetMs !== undefined
            ? { speechEndOffsetMs: event.speechEndOffsetMs }
            : {}),
        });
        session.sttConsecutiveFailures = 0;
      }
      if (event.speechFinal) dispatchDeepgramFinalParts(session);
      return;
    }
    case 'utterance_end':
      if (session.sttAdapter?.id === 'deepgram') {
        if (session.sttDeepgramFinalParts?.length) dispatchDeepgramFinalParts(session);
      }
      return;
    case 'speech_started':
      session.sttLastSpeechStartedAt = Date.now();
      return;
    case 'warning':
      logger.warn(
        { callId: session.callControlId, provider: metricProvider(session) },
        '[stt] Provider warning',
      );
      return;
    case 'entities':
      logger.debug(
        { callId: session.callControlId, entityCount: event.count },
        '[stt] Provider entities received',
      );
      return;
    case 'provider_error': {
      const safeType = SAFE_STT_PROVIDER_ERROR_TYPES.has(event.messageType)
        ? event.messageType
        : sttErrorMetricType(event.messageType);
      const message = `${metricProvider(session)} provider error (${safeType})`;
      logger.error(
        {
          callId: session.callControlId,
          provider: metricProvider(session),
          type: sttErrorMetricType(event.messageType),
        },
        '[stt] Provider error',
      );
      voiceProviderErrorsTotal.inc({
        provider: metricProvider(session),
        type: sttErrorMetricType(event.messageType),
      });
      const terminalReason = terminalSttReason(event.messageType);
      if (terminalReason) triggerSttUnavailable(session, terminalReason, message);
      else session.onSttEvent?.({ type: 'Error', message });
      return;
    }
  }
}

export function handleSttMessage(session: CallSession, msg: ElevenLabsSttMessage): void {
  const adapter = createScribeSttAdapter({ model: configuredModel(session) });
  const normalized = adapter.normalizeMessage(Buffer.from(JSON.stringify(msg)));
  for (const event of normalized) handleNormalizedSttMessage(session, event);
}

export function connectStt(
  session: CallSession,
  onEvent?: (event: SttEvent) => void,
  createSocket: SttWebSocketFactory = (url, options) => new WebSocket(url, options),
): Promise<void> {
  if (onEvent) session.onSttEvent = onEvent;
  const adapter = sttAdapterForSession(session);
  if (process.env.VOICE_STT_LANGUAGE_LOCK === 'true' && adapter.id === 'scribe') {
    session.onAgentSpeaking = () => beginFrenchSttRelock(session, createSocket);
  }
  if (session.sttReady) return session.sttReady;
  if (session.sttRetryTimer || session.sttTerminalFailure || session.sttFallbackTriggered) {
    return Promise.resolve();
  }

  if (process.env.NODE_ENV === 'test') {
    session.sttReady = Promise.resolve();
    return session.sttReady;
  }
  const apiKey =
    adapter.id === 'deepgram'
      ? (process.env.DEEPGRAM_API_KEY ?? '')
      : (process.env.ELEVENLABS_API_KEY ?? '');
  if (!apiKey) {
    if (fallbackToScribeAtOpening(session, createSocket)) {
      return Promise.resolve();
    }
    if (scheduleAutoDetectAfterRelockFailure(session, createSocket)) {
      return Promise.resolve();
    }
    triggerSttUnavailable(
      session,
      'configuration',
      adapter.id === 'deepgram'
        ? 'DEEPGRAM_API_KEY is not configured'
        : 'ELEVENLABS_API_KEY is not configured',
    );
    return Promise.resolve();
  }

  session.sttModel = adapter.model;
  const turnConfig = ensureSttTurnConfig(session);
  ensureSttAvailabilityDeadline(session);
  let ws: WebSocket;
  try {
    const url =
      adapter.id === 'deepgram'
        ? buildDeepgramSttUrl(session.codec, buildSttKeyterms(session.restaurantName))
        : buildSttUrl(adapter.model, session.codec, turnConfig.desired, {
            restaurantName: session.restaurantName,
            filterBackgroundAudio: process.env.VOICE_STT_FILTER_BACKGROUND === 'true',
            forceFrench: session.sttFrenchOnly === true,
          });
    const headers: Record<string, string> =
      adapter.id === 'deepgram' ? { Authorization: `Token ${apiKey}` } : { 'xi-api-key': apiKey };
    ws = adapter.open({ url, headers, createSocket });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    handleSttConnectionFailure(session, error, createSocket);
    return Promise.reject(error);
  }

  let opened = false;
  let failureHandled = false;
  const ready = new Promise<void>((resolve, reject) => {
    session.sttWs = ws;

    ws.on('open', () => {
      if (session.ended || session.sttWs !== ws) {
        ws.close(1000, 'call ended');
        resolve();
        return;
      }
      opened = true;
      session.sttProviderOpenedOnce = true;
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
      if (session.sttConnectionDeadlineTimer) clearTimeout(session.sttConnectionDeadlineTimer);
      session.sttConnectionDeadlineTimer = null;
      // An open provider socket proves availability. Count only consecutive
      // failed opens/closures, while the per-call reconnection budget remains.
      session.sttConsecutiveFailures = 0;
      const pendingAudioBytes =
        session.audioBuffer.reduce((total, chunk) => total + chunk.length, 0) +
        (session.sttChunkBuffer?.length ?? 0);
      session.sttConnectionAudioStartedAt =
        Date.now() - pendingAudioBytes / telnyxBytesPerMs(session.codec);
      session.sttDeepgramFinalParts = [];
      if (session.sttKeepAliveTimer) clearInterval(session.sttKeepAliveTimer);
      session.sttKeepAliveTimer =
        adapter.id === 'deepgram' ? setInterval(() => adapter.keepAlive(ws), 5_000) : null;
      session.sttKeepAliveTimer?.unref?.();
      if (session.sttRelockAttempt) {
        session.sttRelockAttempt = false;
        voiceSttRelockTotal.inc({ result: 'ok' });
      }
      const previousSocket = session.sttRelockPreviousWs;
      session.sttRelockPreviousWs = null;
      if (previousSocket && previousSocket !== ws) {
        try {
          if (previousSocket.readyState === WebSocket.OPEN) {
            previousSocket.close(1000, 'French language relock complete');
          }
        } catch {
          // The newly opened socket is already authoritative.
        }
      }
      writeDebugLog(
        `[stt] ${adapter.id} connected for call ` +
          session.callControlId +
          '; sending ' +
          session.audioBuffer.length +
          ' buffered chunks',
      );
      logger.info(
        { callId: session.callControlId, provider: adapter.id },
        '[stt] Provider connected',
      );
      session.sttFirstAudioChunkSent = false;
      resumeSttAfterOpen(session);
      if (adapter.id === 'scribe') turnConfig.applied = { ...turnConfig.desired };
      if (session.sttRelockPending && session.state === 'SPEAKING') {
        beginFrenchSttRelock(session, createSocket);
      }
      resolve();
    });

    ws.on('message', (raw: Buffer) => {
      if (adapter.id === 'deepgram' && (session.ended || session.sttWs !== ws)) return;
      try {
        for (const event of adapter.normalizeMessage(raw)) {
          handleNormalizedSttMessage(session, event);
        }
      } catch (err) {
        writeDebugLog('[stt] Provider message parse error', err);
        logger.error({ err, callId: session.callControlId }, '[stt] Message parse error');
      }
    });

    ws.on('error', (err: Error) => {
      if (failureHandled || session.sttWs !== ws) return;
      failureHandled = true;
      writeDebugLog(`[stt] ${adapter.id} WebSocket error for call ${session.callControlId}`, err);
      logger.error(
        { err, callId: session.callControlId, provider: adapter.id },
        '[stt] WebSocket error',
      );
      voiceProviderErrorsTotal.inc({ provider: adapter.metricLabel, type: 'ws_error' });
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'stt-bridge', provider: adapter.metricLabel, event: 'websocket-error' },
          extra: { callId: session.callControlId },
        });
      }
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
      if (session.sttKeepAliveTimer) clearInterval(session.sttKeepAliveTimer);
      session.sttKeepAliveTimer = null;
      if (session.sttWs === ws) session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      if (!opened) reject(err);
      handleSttConnectionFailure(session, err, createSocket);
    });

    ws.on('unexpected-response', (_request, response) => {
      if (failureHandled || session.sttWs !== ws) return;
      failureHandled = true;
      response.resume();
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
      if (session.sttKeepAliveTimer) clearInterval(session.sttKeepAliveTimer);
      session.sttKeepAliveTimer = null;
      if (session.sttWs === ws) session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      const statusCode = response.statusCode ?? 0;
      const error = new Error(`${adapter.id} WebSocket handshake failed with HTTP ${statusCode}`);
      if (statusCode === 401 || statusCode === 403) {
        voiceProviderErrorsTotal.inc({ provider: adapter.metricLabel, type: 'auth' });
        if (!opened) reject(error);
        if (fallbackToScribeAtOpening(session, createSocket)) {
          ws.terminate();
          return;
        }
        if (scheduleAutoDetectAfterRelockFailure(session, createSocket)) {
          ws.terminate();
          return;
        }
        triggerSttUnavailable(session, 'auth', error.message);
        ws.terminate();
      } else {
        voiceProviderErrorsTotal.inc({ provider: adapter.metricLabel, type: 'ws_error' });
        if (!opened) reject(error);
        handleSttConnectionFailure(session, error, createSocket);
      }
    });

    ws.on('close', (code: number) => {
      logger.info(
        { callId: session.callControlId, code, provider: adapter.id },
        '[stt] Provider connection closed',
      );
      if (failureHandled || session.sttWs !== ws) return;
      failureHandled = true;
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
      if (session.sttKeepAliveTimer) clearInterval(session.sttKeepAliveTimer);
      session.sttKeepAliveTimer = null;
      session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      const error = new Error(`${adapter.id} WebSocket closed before the call ended`);
      if (!opened) reject(error);
      handleSttConnectionFailure(session, error, createSocket);
    });

    session.sttConnectTimeout = setTimeout(() => {
      if (failureHandled || opened || session.sttWs !== ws) return;
      failureHandled = true;
      session.sttConnectTimeout = null;
      if (session.sttKeepAliveTimer) clearInterval(session.sttKeepAliveTimer);
      session.sttKeepAliveTimer = null;
      session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      const error = new Error(`${adapter.id} WebSocket connection timed out`);
      reject(error);
      handleSttConnectionFailure(session, error, createSocket);
      ws.terminate();
    }, STT_CONNECT_TIMEOUT_MS);
  });

  session.sttReady = ready;
  return ready;
}

export function sendAudioToStt(session: CallSession, audioPayload: string): void {
  if (session.sttTerminalFailure || session.sttFallbackTriggered) return;
  const input = Buffer.from(audioPayload, 'base64');

  if (
    !session.sttWs &&
    !session.sttReady &&
    !session.sttRetryTimer &&
    !session.sttTerminalFailure &&
    !session.sttFallbackTriggered
  ) {
    connectStt(session).catch((_err) => {
      logger.error(
        { callId: session.callControlId, provider: metricProvider(session) },
        '[stt] Provider connection failed while sending audio',
      );
    });
  }

  const chunkMs = getSttChunkMs();
  if (chunkMs <= STT_CHUNK_MS_DEFAULT) {
    // Défaut : une trame = un message, chemin strictement inchangé.
    deliverSttAudio(session, input);
    return;
  }
  appendSttChunk(session, input, chunkMs);
}

export function closeStt(session: CallSession): void {
  // Fin d'appel : envoyer ce qui reste avant de couper la socket.
  flushSttChunkBuffer(session);
  if (session.sttRelockPending || session.sttRelockAttempt) {
    voiceSttRelockTotal.inc({ result: 'skipped' });
    session.sttRelockPending = false;
    session.sttRelockAttempt = false;
  }
  session.onAgentSpeaking = undefined;
  const previousSocket = session.sttRelockPreviousWs;
  session.sttRelockPreviousWs = null;
  clearPendingSttEndOfTurn(session);
  clearSemanticHold(session);
  clearPendingSttCommit(session);
  clearSttRecoveryTimers(session);
  const ws = session.sttWs;
  session.sttWs = null;
  session.sttReady = null;
  const adapter = sttAdapterForSession(session);
  for (const socket of new Set(
    [ws, previousSocket].filter((socket): socket is WebSocket => !!socket),
  )) {
    try {
      if (socket.readyState === WebSocket.OPEN) adapter.finalize(socket);
      adapter.close(socket, 1000, 'call ended');
    } catch (_err) {
      logger.warn(
        { callId: session.callControlId, provider: adapter.id },
        '[stt] Failed to close provider socket',
      );
    }
  }
}

/** Attentes ajoutées après le commit Scribe, selon la forme de la phrase. */
export const SMART_ENDPOINT_HOLD_COMPLETE_MS = 0;
export const SMART_ENDPOINT_HOLD_SUSPENDED_MS = 800;
export const SMART_ENDPOINT_HOLD_CORRECTION_MS = 600;
export const SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS = 400;

export type SmartEndpointReason = 'complete' | 'suspended' | 'correction' | 'no_punctuation';

/** Minuscules sans accents : « À » et « a » se comparent de la même façon. */
function normalizeForEndpoint(transcript: string): string {
  return transcript
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’]/g, "'")
    .toLowerCase()
    .trim();
}

// Fin en suspens : préposition, article, conjonction ou présentation
// laissée sans suite (« demain à », « au nom de », « je suis »).
const SUSPENDED_ENDING =
  /(?:^|[\s,])(?:pour|a|vers|de|du|des|d'|le|la|les|l'|au|aux|chez|avec|et|ou|mais|donc|alors|puis|du coup|au nom de|je suis|c'est|mon nom est|on sera|nous serons|il y aura|je voudrais|j'aimerais)\s*,?$/;
const CORRECTION_START = /^(?:non\s*[,.]?\s+\S|plutot\b|en fait\b|j'ai dit\b|je voulais dire\b)/;
const TERMINAL_PUNCTUATION = /[.!?]$/;
// Réponse courte, complète même sans ponctuation (« oui », « d'accord »).
const SHORT_ANSWER = /^(?:\S+)(?:\s+\S+)?$/;

/**
 * Délai d'attente supplémentaire avant d'envoyer un tour, une fois le
 * silence Scribe écoulé. 0 ms signifie que la phrase part tout de suite.
 */
export function getSmartEndpointDelay(transcript: string): {
  holdMs: number;
  reason: SmartEndpointReason;
} {
  const text = normalizeForEndpoint(transcript);
  if (SUSPENDED_ENDING.test(text)) {
    return { holdMs: SMART_ENDPOINT_HOLD_SUSPENDED_MS, reason: 'suspended' };
  }
  if (CORRECTION_START.test(text) && !TERMINAL_PUNCTUATION.test(text)) {
    return { holdMs: SMART_ENDPOINT_HOLD_CORRECTION_MS, reason: 'correction' };
  }
  if (TERMINAL_PUNCTUATION.test(text) || SHORT_ANSWER.test(text)) {
    return { holdMs: SMART_ENDPOINT_HOLD_COMPLETE_MS, reason: 'complete' };
  }
  return { holdMs: SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS, reason: 'no_punctuation' };
}
