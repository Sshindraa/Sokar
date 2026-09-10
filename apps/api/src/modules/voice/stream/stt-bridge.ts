import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { CallSession, SttEvent, SttTurnConfig, SttWord } from './types';
import { CallSessionManager } from './manager';
import { isNameCollectionBlocking } from './conversation-controller';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { isSpeculativeLlmEnabled } from './speculation';
import { redactPii } from './pii-redact';
import { voiceProviderErrorsTotal } from '../../../shared/observability/metrics';

const DEFAULT_STT_MODEL = 'scribe_v2_realtime';
const STT_REALTIME_PATH = '/v1/speech-to-text/realtime';
const STT_PROVIDER_LABEL = 'elevenlabs_stt';

export const DEFAULT_STT_TURN_CONFIG: SttTurnConfig = {
  vadSilenceThresholdSecs: 0.85,
  minSpeechDurationMs: 80,
  minSilenceDurationMs: 120,
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
];

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

function getBaseSttTurnConfig(): SttTurnConfig {
  return {
    vadSilenceThresholdSecs: readConfiguredNumber(
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
    const base = getBaseSttTurnConfig();
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
): string {
  const params = new URLSearchParams({
    model_id: model,
    audio_format: codec === 'PCMU' ? 'ulaw_8000' : 'pcm_8000',
    language_code: 'fr',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: String(turnConfig.vadSilenceThresholdSecs),
    vad_threshold: '0.4',
    min_speech_duration_ms: String(turnConfig.minSpeechDurationMs),
    min_silence_duration_ms: String(turnConfig.minSilenceDurationMs),
    include_timestamps: 'true',
  });

  for (const keyterm of RESERVATION_KEYTERMS) params.append('keyterms', keyterm);
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

function dispatchUtteranceEnd(session: CallSession, transcript: string, words?: SttWord[]): void {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;
  logger.info(
    { callId: session.callControlId, transcript: redactPii(cleanTranscript.slice(0, 100)) },
    '[stt] End of turn',
  );
  session.onSttEvent?.({
    type: 'UtteranceEnd',
    transcript: cleanTranscript,
    ...(words ? { words } : {}),
  });
}

function schedulePendingSttEndOfTurn(session: CallSession): void {
  if (session.sttEndOfTurnTimer) clearTimeout(session.sttEndOfTurnTimer);
  session.sttEndOfTurnTimer = setTimeout(() => {
    const pending = session.pendingSttEndOfTurn;
    session.pendingSttEndOfTurn = null;
    session.sttEndOfTurnTimer = null;
    if (pending) dispatchUtteranceEnd(session, pending.transcript, pending.words);
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
  dispatchUtteranceEnd(session, pending.transcript, pending.words);
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

function sendAudioChunk(ws: WebSocket, audio: Buffer): void {
  ws.send(
    JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: audio.toString('base64'),
    }),
  );
}

export interface ElevenLabsSttMessage {
  message_type?: string;
  text?: string;
  error?: string;
  message?: string;
  words?: Array<{
    word?: string;
    text?: string;
    start?: number;
    end?: number;
    confidence?: number;
    type?: string;
  }>;
}

function getMessageText(msg: ElevenLabsSttMessage): string {
  return typeof msg.text === 'string' ? msg.text.trim() : '';
}

function getMessageWords(msg: ElevenLabsSttMessage): SttWord[] | undefined {
  if (!msg.words?.length) return undefined;
  const words = msg.words
    .map((word) => {
      const text = word.word ?? word.text;
      if (!text) return null;
      return {
        word: text,
        ...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
        ...(typeof word.start === 'number' ? { start: word.start } : {}),
        ...(typeof word.end === 'number' ? { end: word.end } : {}),
      };
    })
    .filter((word): word is SttWord => word !== null);
  return words.length ? words : undefined;
}

function handleBargeInFromTranscript(
  session: CallSession,
  mgr: CallSessionManager,
  transcript: string,
): void {
  if (session.state !== 'SPEAKING' || !transcript.trim()) return;
  logger.info(
    { callId: session.callControlId, transcript: redactPii(transcript.trim()) },
    '[barge-in] User spoke while assistant was speaking. Interrupting.',
  );
  session.abortController?.abort();
  session.abortController = null;
  mgr.handleBargeIn(session);
}

function emitPartialTranscript(session: CallSession, transcript: string): void {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;

  const mgr = CallSessionManager.getInstance();
  handleBargeInFromTranscript(session, mgr, cleanTranscript);

  if (!session.turnTranscript.trim()) {
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
): void {
  const cleanTranscript = transcript.trim() || session.turnTranscript.trim();
  session.turnTranscript = '';
  if (!cleanTranscript) return;

  // Le partial est normalement le premier signal de barge-in, mais Scribe
  // peut engager un transcript sans partial observable sur une connexion
  // courte. Le commit doit donc rester suffisant pour interrompre le TTS.
  handleBargeInFromTranscript(session, CallSessionManager.getInstance(), cleanTranscript);

  const spellingProfileActive =
    isNameCollectionBlocking(session) || session.conversation.pendingQuestion === 'customerName';
  if (spellingProfileActive) {
    session.pendingSttEndOfTurn = { transcript: cleanTranscript, ...(words ? { words } : {}) };
    schedulePendingSttEndOfTurn(session);
    return;
  }
  dispatchUtteranceEnd(session, cleanTranscript, words);
}

export function handleSttMessage(session: CallSession, msg: ElevenLabsSttMessage): void {
  switch (msg.message_type) {
    case 'session_started':
      logger.info({ callId: session.callControlId }, '[stt] ElevenLabs Scribe session started');
      return;
    case 'partial_transcript':
      emitPartialTranscript(session, getMessageText(msg));
      return;
    case 'committed_transcript':
    case 'committed_transcript_with_timestamps':
      dispatchCommittedTranscript(session, getMessageText(msg), getMessageWords(msg));
      return;
    case 'auth_error':
    case 'quota_exceeded':
    case 'rate_limited':
    case 'scribe_error':
    case 'error': {
      const message = msg.error ?? msg.message ?? 'ElevenLabs STT error';
      logger.error({ callId: session.callControlId, message }, '[stt] Provider error');
      voiceProviderErrorsTotal.inc({ provider: STT_PROVIDER_LABEL, type: 'provider_error' });
      session.onSttEvent?.({ type: 'Error', message });
      return;
    }
    default:
      return;
  }
}

export function connectStt(
  session: CallSession,
  onEvent?: (event: SttEvent) => void,
): Promise<void> {
  if (onEvent) session.onSttEvent = onEvent;
  if (session.sttReady) return session.sttReady;

  const apiKey = process.env.ELEVENLABS_API_KEY ?? '';
  if (!apiKey || process.env.NODE_ENV === 'test') {
    session.sttReady = Promise.resolve();
    return session.sttReady;
  }

  const model = configuredModel(session);
  session.sttModel = model;
  const turnConfig = ensureSttTurnConfig(session);
  const ready = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(buildSttUrl(model, session.codec, turnConfig.desired), {
      headers: { 'xi-api-key': apiKey },
    });
    session.sttWs = ws;

    ws.on('open', () => {
      writeDebugLog(
        '[stt] ElevenLabs Scribe connected for call ' +
          session.callControlId +
          '; sending ' +
          session.audioBuffer.length +
          ' buffered chunks',
      );
      logger.info({ callId: session.callControlId }, '[stt] ElevenLabs Scribe connected');
      for (const chunk of session.audioBuffer) sendAudioChunk(ws, chunk);
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
      writeDebugLog('[stt] ElevenLabs WebSocket error for call ' + session.callControlId, err);
      logger.error({ err, callId: session.callControlId }, '[stt] Error: ' + err.message);
      voiceProviderErrorsTotal.inc({ provider: STT_PROVIDER_LABEL, type: 'ws_error' });
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'stt-bridge', provider: STT_PROVIDER_LABEL, event: 'websocket-error' },
          extra: { callId: session.callControlId },
        });
      }
      session.sttWs = null;
      session.sttReady = null;
      reject(err);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      logger.info(
        { callId: session.callControlId, code, reason: reason.toString() },
        '[stt] ElevenLabs Scribe connection closed',
      );
      session.sttWs = null;
      session.sttReady = null;
    });
  });

  session.sttReady = ready;
  return ready;
}

export function sendAudioToStt(session: CallSession, audioPayload: string): void {
  const input = toSttAudio(session.codec, Buffer.from(audioPayload, 'base64'));

  if (!session.sttWs && !session.sttReady) {
    connectStt(session).catch((err) => {
      logger.error(
        { err, callId: session.callControlId },
        '[stt] ElevenLabs connection failed while sending audio',
      );
    });
  }

  if (session.sttWs?.readyState === WebSocket.OPEN) {
    sendAudioChunk(session.sttWs, input);
    return;
  }

  if (session.audioBuffer.length >= STT_AUDIO_BUFFER_MAX) session.audioBuffer.shift();
  session.audioBuffer.push(input);
}

export function closeStt(session: CallSession): void {
  clearPendingSttEndOfTurn(session);
  const ws = session.sttWs;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.close(1000, 'call ended');
  } catch (err) {
    logger.warn({ err, callId: session.callControlId }, '[stt] Failed to close Scribe socket');
  }
}

export const SMART_ENDPOINT_DELAY_WITH_PUNCTUATION_MS = 650;
export const SMART_ENDPOINT_DELAY_WITHOUT_PUNCTUATION_MS = 1_200;
export const SMART_ENDPOINT_DELAY_INCOMPLETE_RESERVATION_MS = 1_300;
export const SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS = 2_500;
export const SMART_ENDPOINT_DELAY_INCOMPLETE_FRAGMENT_MS = 1_500;

export function getSmartEndpointDelay(transcript: string): {
  timeoutMs: number;
  reason:
    | 'punctuation'
    | 'incomplete_identity'
    | 'incomplete_reservation'
    | 'incomplete_fragment'
    | 'silence';
} {
  const endsWithPunctuation = /[.!?]\s*$/.test(transcript);
  const soundsLikeIdentityIntroduction =
    /\b(?:je\s+suis|mon\s+nom\s+est)\s+(?:[\p{L}-]+\s*){1,3}$/iu.test(transcript);
  const startsWithCorrection =
    /^\s*(?:non\b|plutot\b|en\s+fait\b|j['’]ai\s+dit\b|je\s+voulais\s+dire\b)/iu.test(transcript);
  const endsWithReservationFragment =
    /\b(?:pour|a|vers)\s*$|\b(?:demain|aujourd['’]hui)\s+(?:a|vers)\s*$/iu.test(transcript);
  const endsWithShortConnector =
    /^(?:ok(?:ay)?|d['’]accord|donc|du coup|mais|alors|et)(?:\s+(?:donc|du coup|alors))?\s*[.!?]?$/iu.test(
      transcript.trim(),
    );

  if (soundsLikeIdentityIntroduction) {
    return {
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS,
      reason: 'incomplete_identity',
    };
  }
  if (startsWithCorrection || endsWithReservationFragment) {
    return {
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_RESERVATION_MS,
      reason: 'incomplete_reservation',
    };
  }
  if (endsWithShortConnector) {
    return {
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_FRAGMENT_MS,
      reason: 'incomplete_fragment',
    };
  }
  if (endsWithPunctuation) {
    return { timeoutMs: SMART_ENDPOINT_DELAY_WITH_PUNCTUATION_MS, reason: 'punctuation' };
  }
  return { timeoutMs: SMART_ENDPOINT_DELAY_WITHOUT_PUNCTUATION_MS, reason: 'silence' };
}
