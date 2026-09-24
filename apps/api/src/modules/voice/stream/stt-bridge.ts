import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { CallSession, SttEvent, SttTurnConfig, SttWord } from './types';
import { CallSessionManager } from './manager';
import { isNameCollectionBlocking } from './conversation-controller';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { isSpeculativeLlmEnabled } from './speculation';
import { describeTranscript } from './pii-redact';
import { voiceProviderErrorsTotal } from '../../../shared/observability/metrics';
import { addSttAudioSamples, sttSamplesForBuffer } from '../../usage/voice-usage.service';
import { alertTerminalSttUnavailable, recordSttConnectionUnavailable } from './stt-alerts';

const DEFAULT_STT_MODEL = 'scribe_v2_realtime';
const STT_REALTIME_PATH = '/v1/speech-to-text/realtime';
const STT_PROVIDER_LABEL = 'elevenlabs_stt';
export const STT_RETRY_BACKOFF_MS = [500, 1_000, 2_000] as const;
export const STT_MAX_CONSECUTIVE_FAILURES = 4;
export const STT_MAX_RECONNECTIONS_PER_CALL = 8;
export const STT_CONNECT_TIMEOUT_MS = 2_500;
// Laisse passer quatre délais de connexion (4 × 2,5 s) et le backoff
// (3,5 s) avant le repli déclenché par la limite d'échecs consécutifs.
export const STT_UNAVAILABLE_DEADLINE_MS = 15_000;

type SttWebSocketFactory = (url: string, options: { headers: Record<string, string> }) => WebSocket;

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
    voiceProviderErrorsTotal.inc({ provider: STT_PROVIDER_LABEL, type: 'connection_unavailable' });
    recordSttConnectionUnavailable().catch((error) =>
      logger.warn({ err: error }, '[stt] Could not dispatch connection alert'),
    );
  } else if (reason === 'quota' || reason === 'auth' || reason === 'terms') {
    alertTerminalSttUnavailable(reason).catch((error) =>
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

/**
 * Construit l'URL Scribe Realtime. PCMU est envoyé directement en ulaw_8000.
 * PCMA est converti en PCM16 avant émission et utilise pcm_8000.
 */
export function buildSttUrl(
  model: string = DEFAULT_STT_MODEL,
  codec: 'PCMA' | 'PCMU' = 'PCMU',
  turnConfig: SttTurnConfig = getBaseSttTurnConfig(),
  options: {
    restaurantName?: string;
    keyterms?: readonly string[];
    languages?: readonly string[];
  } = {},
): string {
  const params = new URLSearchParams({
    model_id: model,
    audio_format: codec === 'PCMU' ? 'ulaw_8000' : 'pcm_8000',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: String(turnConfig.vadSilenceThresholdSecs),
    vad_threshold: '0.4',
    min_speech_duration_ms: String(turnConfig.minSpeechDurationMs),
    min_silence_duration_ms: String(turnConfig.minSilenceDurationMs),
    include_timestamps: 'true',
    include_language_detection: 'true',
  });

  for (const language of options.languages ?? getSttLanguageCodes()) {
    const normalized = normalizeSttLanguageCode(language);
    if (STT_LANGUAGE_CODE_PATTERN.test(normalized)) {
      params.append('secondary_languages', normalized);
    }
  }
  for (const keyterm of buildSttKeyterms(options.restaurantName, options.keyterms)) {
    params.append('keyterms', keyterm);
  }
  return 'wss://' + getSttHost() + STT_REALTIME_PATH + '?' + params.toString();
}

/**
 * Scribe ne propose pas de reconfiguration sur une socket active. On mémorise
 * le profil métier pour une prochaine connexion et pour la grâce de fin de tour.
 */
export function setSttSpellingProfile(session: CallSession, active: boolean): void {
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

function clearSemanticHold(
  session: CallSession,
): NonNullable<CallSession['sttSemanticHold']> | null {
  const hold = session.sttSemanticHold ?? null;
  if (hold?.timer) clearTimeout(hold.timer);
  session.sttSemanticHold = null;
  return hold;
}

function armSemanticHoldTimer(
  session: CallSession,
  hold: NonNullable<CallSession['sttSemanticHold']>,
): void {
  if (hold.timer) clearTimeout(hold.timer);
  hold.timer = setTimeout(() => {
    if (session.sttSemanticHold !== hold) return;
    session.sttSemanticHold = null;
    dispatchUtteranceEnd(session, hold.transcript, hold.words, hold.languageCode);
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
): void {
  const previous = clearSemanticHold(session);
  const merged = previous ? mergeSttTranscripts(previous.transcript, transcript) : transcript;
  const mergedWords = previous?.words && words ? [...previous.words, ...words] : words;
  const mergedLanguage = languageCode ?? previous?.languageCode;

  const { holdMs, reason } = getSmartEndpointDelay(merged);
  if (holdMs === 0) {
    dispatchUtteranceEnd(session, merged, mergedWords, mergedLanguage);
    return;
  }

  logger.debug({ callId: session.callControlId, reason, holdMs }, '[stt] Holding end of turn');
  const hold: NonNullable<CallSession['sttSemanticHold']> = {
    transcript: merged,
    ...(mergedWords ? { words: mergedWords } : {}),
    ...(mergedLanguage ? { languageCode: mergedLanguage } : {}),
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
): void {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;
  if (languageCode) session.sttLanguageCode = languageCode;
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
  });
}

function schedulePendingSttEndOfTurn(session: CallSession): void {
  if (session.sttEndOfTurnTimer) clearTimeout(session.sttEndOfTurnTimer);
  session.sttEndOfTurnTimer = setTimeout(() => {
    const pending = session.pendingSttEndOfTurn;
    session.pendingSttEndOfTurn = null;
    session.sttEndOfTurnTimer = null;
    if (pending)
      dispatchUtteranceEnd(session, pending.transcript, pending.words, pending.languageCode);
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
  dispatchUtteranceEnd(session, pending.transcript, pending.words, pending.languageCode);
}

function toPcm16FromAlaw(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let index = 0; index < input.length; index++) {
    const alaw = input[index] ^ 0x55;
    let sample = (alaw & 0x0f) << 4;
    const segment = (alaw & 0x70) >> 4;
    if (segment === 0) sample += 8;
    else if (segment === 1) sample += 0x108;
    else sample = (sample + 0x108) << (segment - 1);
    output.writeInt16LE(alaw & 0x80 ? sample : -sample, index * 2);
  }
  return output;
}

function toSttAudio(codec: CallSession['codec'], input: Buffer): Buffer {
  return codec === 'PCMA' ? toPcm16FromAlaw(input) : input;
}

function sendAudioChunk(ws: WebSocket, audio: Buffer, previousText?: string): void {
  ws.send(
    JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: audio.toString('base64'),
      ...(previousText ? { previous_text: previousText } : {}),
    }),
  );
}

function sendSessionAudioChunk(session: CallSession, audio: Buffer): void {
  if (!session.sttWs) return;
  const isFirstChunk = !session.sttFirstAudioChunkSent;
  sendAudioChunk(
    session.sttWs,
    audio,
    isFirstChunk ? buildSttPreviousText(session.restaurantName) : undefined,
  );
  addSttAudioSamples(session, sttSamplesForBuffer(session, audio.length));
  session.sttFirstAudioChunkSent = true;
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

const STT_PROVIDER_ERROR_TYPES = new Set([
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

function isSttProviderError(messageType: string | undefined): boolean {
  if (!messageType) return false;
  return STT_PROVIDER_ERROR_TYPES.has(messageType) || /error$/iu.test(messageType);
}

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

function getMessageText(msg: ElevenLabsSttMessage): string {
  return typeof msg.text === 'string' ? msg.text.trim() : '';
}

function getMessageLanguageCode(msg: ElevenLabsSttMessage): string | undefined {
  const languageCode = msg.language_code?.trim().toLowerCase();
  return languageCode && STT_LANGUAGE_CODE_PATTERN.test(languageCode) ? languageCode : undefined;
}

/**
 * Confiance d'un mot entre 0 et 1. Scribe Realtime ne fournit que `logprob` :
 * sans cette conversion, aucune confiance n'était jamais conservée.
 */
function wordConfidence(word: { confidence?: number; logprob?: number }): { confidence?: number } {
  if (typeof word.confidence === 'number') return { confidence: word.confidence };
  if (typeof word.logprob === 'number' && Number.isFinite(word.logprob)) {
    return { confidence: Math.min(1, Math.max(0, Math.exp(word.logprob))) };
  }
  return {};
}

function getMessageWords(msg: ElevenLabsSttMessage): SttWord[] | undefined {
  if (!msg.words?.length) return undefined;
  const words = msg.words
    .map((word) => {
      const text = word.word ?? word.text;
      if (!text) return null;
      return {
        word: text,
        ...wordConfidence(word),
        ...(typeof word.start === 'number' ? { start: word.start } : {}),
        ...(typeof word.end === 'number' ? { end: word.end } : {}),
      };
    })
    .filter((word): word is SttWord => word !== null);
  return words.length ? words : undefined;
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
    );
  // Le commit clôt ce segment même si l'événement horodaté arrive quelques
  // millisecondes plus tard ; un nouveau partial doit démarrer un tour neuf.
  session.turnTranscript = '';

  const timer = setTimeout(() => {
    const pending = session.sttPendingCommit;
    if (!pending) return;
    session.sttPendingCommit = null;
    dispatchCommittedTranscript(session, pending.transcript, pending.words, pending.languageCode);
  }, STT_TIMESTAMPED_COMMIT_GRACE_MS);
  session.sttPendingCommit = {
    transcript: cleanTranscript,
    ...(words ? { words } : {}),
    ...(languageCode ? { languageCode } : {}),
    timer,
  };
}

function dispatchTimestampedCommittedTranscript(
  session: CallSession,
  transcript: string,
  words?: SttWord[],
  languageCode?: string,
): void {
  const pending = session.sttPendingCommit;
  if (pending && (!transcript.trim() || sameTranscript(pending.transcript, transcript))) {
    clearPendingSttCommit(session);
    dispatchCommittedTranscript(
      session,
      transcript.trim() || pending.transcript,
      words ?? pending.words,
      languageCode ?? pending.languageCode,
    );
    return;
  }
  if (pending) {
    clearPendingSttCommit(session);
    dispatchCommittedTranscript(session, pending.transcript, pending.words, pending.languageCode);
  }
  dispatchCommittedTranscript(session, transcript, words, languageCode);
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
  session.abortController?.abort();
  session.abortController = null;
  mgr.handleBargeIn(session);
}

function emitPartialTranscript(session: CallSession, transcript: string): void {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;

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
    session.onSttEvent?.({ type: 'UtteranceStart' });
  } else if (session.state === 'PROCESSING' && cleanTranscript !== session.turnTranscript) {
    session.onSttEvent?.({ type: 'SpeechResumed' });
  }

  session.turnTranscript = mergeSttTranscripts(session.turnTranscript, cleanTranscript);

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
): void {
  const cleanTranscript = transcript.trim() || session.turnTranscript.trim();
  session.turnTranscript = '';
  if (!cleanTranscript) return;

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
    };
    schedulePendingSttEndOfTurn(session);
    return;
  }
  if (isSmartEndpointEnabled(session)) {
    dispatchOrHoldUtteranceEnd(session, cleanTranscript, words, languageCode);
    return;
  }
  dispatchUtteranceEnd(session, cleanTranscript, words, languageCode);
}

export function handleSttMessage(session: CallSession, msg: ElevenLabsSttMessage): void {
  switch (msg.message_type) {
    case 'session_started':
      logger.info({ callId: session.callControlId }, '[stt] ElevenLabs Scribe session started');
      return;
    case 'partial_transcript':
      if (getMessageText(msg).trim()) session.sttConsecutiveFailures = 0;
      emitPartialTranscript(session, getMessageText(msg));
      return;
    case 'committed_transcript':
      if (getMessageText(msg).trim()) session.sttConsecutiveFailures = 0;
      queuePlainCommittedTranscript(
        session,
        getMessageText(msg),
        getMessageWords(msg),
        getMessageLanguageCode(msg),
      );
      return;
    case 'committed_transcript_with_timestamps':
      if (getMessageText(msg).trim()) session.sttConsecutiveFailures = 0;
      dispatchTimestampedCommittedTranscript(
        session,
        getMessageText(msg),
        getMessageWords(msg),
        getMessageLanguageCode(msg),
      );
      return;
    case 'warning':
      logger.warn(
        {
          callId: session.callControlId,
          warning: msg.warning ?? msg.message ?? 'ElevenLabs STT warning',
        },
        '[stt] Provider warning',
      );
      return;
    case 'committed_transcript_entities':
      // Les entités ne sont pas activées par défaut (surcoût provider). Si
      // elles le sont ultérieurement, ne jamais écrire leur contenu en clair.
      logger.debug(
        { callId: session.callControlId, entityCount: msg.entities?.length ?? 0 },
        '[stt] Provider entities received',
      );
      return;
    default:
      if (!isSttProviderError(msg.message_type)) return;
      {
        const message = msg.error ?? msg.message ?? 'ElevenLabs STT error';
        logger.error(
          { callId: session.callControlId, message, type: msg.message_type },
          '[stt] Provider error',
        );
        voiceProviderErrorsTotal.inc({
          provider: STT_PROVIDER_LABEL,
          type: sttErrorMetricType(msg.message_type),
        });
        const terminalReason = terminalSttReason(msg.message_type);
        if (terminalReason) {
          triggerSttUnavailable(session, terminalReason, message);
        } else {
          session.onSttEvent?.({ type: 'Error', message });
        }
        return;
      }
  }
}

export function connectStt(
  session: CallSession,
  onEvent?: (event: SttEvent) => void,
  createSocket: SttWebSocketFactory = (url, options) => new WebSocket(url, options),
): Promise<void> {
  if (onEvent) session.onSttEvent = onEvent;
  if (session.sttReady) return session.sttReady;
  if (session.sttRetryTimer || session.sttTerminalFailure || session.sttFallbackTriggered) {
    return Promise.resolve();
  }

  const apiKey = process.env.ELEVENLABS_API_KEY ?? '';
  if (process.env.NODE_ENV === 'test') {
    session.sttReady = Promise.resolve();
    return session.sttReady;
  }
  if (!apiKey) {
    triggerSttUnavailable(session, 'configuration', 'ELEVENLABS_API_KEY is not configured');
    return Promise.resolve();
  }

  const model = configuredModel(session);
  session.sttModel = model;
  const turnConfig = ensureSttTurnConfig(session);
  ensureSttAvailabilityDeadline(session);
  let ws: WebSocket;
  try {
    ws = createSocket(
      buildSttUrl(model, session.codec, turnConfig.desired, {
        restaurantName: session.restaurantName,
      }),
      { headers: { 'xi-api-key': apiKey } },
    );
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
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
      if (session.sttConnectionDeadlineTimer) clearTimeout(session.sttConnectionDeadlineTimer);
      session.sttConnectionDeadlineTimer = null;
      // An open Scribe socket proves availability. Count only consecutive
      // failed opens/closures, while the per-call reconnection budget remains.
      session.sttConsecutiveFailures = 0;
      writeDebugLog(
        '[stt] ElevenLabs Scribe connected for call ' +
          session.callControlId +
          '; sending ' +
          session.audioBuffer.length +
          ' buffered chunks',
      );
      logger.info({ callId: session.callControlId }, '[stt] ElevenLabs Scribe connected');
      session.sttFirstAudioChunkSent = false;
      for (const chunk of session.audioBuffer) sendSessionAudioChunk(session, chunk);
      session.audioBuffer = [];
      turnConfig.applied = { ...turnConfig.desired };
      resolve();
    });

    ws.on('message', (raw: Buffer) => {
      try {
        handleSttMessage(session, JSON.parse(raw.toString()) as ElevenLabsSttMessage);
      } catch (err) {
        writeDebugLog('[stt] ElevenLabs message parse error', err);
        logger.error({ err, callId: session.callControlId }, '[stt] Message parse error');
      }
    });

    ws.on('error', (err: Error) => {
      if (failureHandled || session.sttWs !== ws) return;
      failureHandled = true;
      writeDebugLog('[stt] ElevenLabs WebSocket error for call ' + session.callControlId, err);
      logger.error({ err, callId: session.callControlId }, '[stt] Error: ' + err.message);
      voiceProviderErrorsTotal.inc({ provider: STT_PROVIDER_LABEL, type: 'ws_error' });
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'stt-bridge', provider: STT_PROVIDER_LABEL, event: 'websocket-error' },
          extra: { callId: session.callControlId },
        });
      }
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
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
      if (session.sttWs === ws) session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      const statusCode = response.statusCode ?? 0;
      const error = new Error(
        'ElevenLabs Scribe WebSocket handshake failed with HTTP ' + statusCode,
      );
      if (statusCode === 401 || statusCode === 403) {
        voiceProviderErrorsTotal.inc({ provider: STT_PROVIDER_LABEL, type: 'auth' });
        if (!opened) reject(error);
        triggerSttUnavailable(session, 'auth', error.message);
        ws.terminate();
      } else {
        voiceProviderErrorsTotal.inc({ provider: STT_PROVIDER_LABEL, type: 'ws_error' });
        if (!opened) reject(error);
        handleSttConnectionFailure(session, error, createSocket);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      logger.info(
        { callId: session.callControlId, code, reason: reason.toString() },
        '[stt] ElevenLabs Scribe connection closed',
      );
      if (failureHandled || session.sttWs !== ws) return;
      failureHandled = true;
      if (session.sttConnectTimeout) clearTimeout(session.sttConnectTimeout);
      session.sttConnectTimeout = null;
      session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      const error = new Error('ElevenLabs Scribe WebSocket closed before the call ended');
      if (!opened) reject(error);
      handleSttConnectionFailure(session, error, createSocket);
    });

    session.sttConnectTimeout = setTimeout(() => {
      if (failureHandled || opened || session.sttWs !== ws) return;
      failureHandled = true;
      session.sttConnectTimeout = null;
      session.sttWs = null;
      if (session.sttReady === ready) session.sttReady = null;
      const error = new Error('ElevenLabs Scribe WebSocket connection timed out');
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
  const input = toSttAudio(session.codec, Buffer.from(audioPayload, 'base64'));

  if (
    !session.sttWs &&
    !session.sttReady &&
    !session.sttRetryTimer &&
    !session.sttTerminalFailure &&
    !session.sttFallbackTriggered
  ) {
    connectStt(session).catch((err) => {
      logger.error(
        { err, callId: session.callControlId },
        '[stt] ElevenLabs connection failed while sending audio',
      );
    });
  }

  if (session.sttWs?.readyState === WebSocket.OPEN) {
    sendSessionAudioChunk(session, input);
    return;
  }

  if (session.audioBuffer.length >= STT_AUDIO_BUFFER_MAX) session.audioBuffer.shift();
  session.audioBuffer.push(input);
}

export function closeStt(session: CallSession): void {
  clearPendingSttEndOfTurn(session);
  clearSemanticHold(session);
  clearPendingSttCommit(session);
  clearSttRecoveryTimers(session);
  const ws = session.sttWs;
  session.sttWs = null;
  session.sttReady = null;
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'call ended');
    else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
  } catch (err) {
    logger.warn({ err, callId: session.callControlId }, '[stt] Failed to close Scribe socket');
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
