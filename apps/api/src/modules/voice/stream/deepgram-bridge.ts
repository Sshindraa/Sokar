import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CallSession,
  DeepgramTurnConfigState,
  FluxEvent,
  FluxTurnConfig,
  FluxWord,
} from './types';
import { CallSessionManager } from './manager';
import { isNameCollectionBlocking } from './conversation-controller';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { DEEPGRAM_CLOSE_DELAY_MS } from '../../../shared/constants/timeouts.js';
import { isSpeculativeLlmEnabled } from './speculation';
import { redactPii } from './pii-redact';
import { voiceProviderErrorsTotal } from '../../../shared/observability/metrics';

function writeDebugLog(msg: string, err?: unknown) {
  const e = err instanceof Error ? err : err ? new Error(String(err)) : undefined;
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}${e ? ' | ERROR: ' + e.message + '\n' + e.stack : ''}\n`;
  try {
    const logPath =
      process.env.DEBUG_LOG_PATH || path.join(process.cwd(), 'scratch', 'call_debug.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logMsg);
  } catch (e) {
    logger.error({ err: e }, 'Failed to write debug log');
  }
}

// Deepgram Flux (turn-detection + interim + EagerEndOfTurn) vit sur l'API v2.
// Le model_id officiel est `flux-general-multi` (multilingue, dont fr).
// On garde l'override par env var (DEEPGRAM_MODEL) pour permettre un fallback
// vers `nova-3` (v1/listen) si Flux est trop instable en prod.
const DEEPGRAM_HOST = process.env.DEEPGRAM_API_HOST ?? 'api.deepgram.com';
const DEEPGRAM_API_URL_FLUX = `wss://${DEEPGRAM_HOST}/v2/listen`;
const DEEPGRAM_API_URL_NOVA = `wss://${DEEPGRAM_HOST}/v1/listen`;
const DEEPGRAM_DEFAULT_MODEL = 'flux-general-multi';

export const DEFAULT_FLUX_TURN_CONFIG: FluxTurnConfig = {
  eotThreshold: 0.7,
  eotTimeoutMs: 5_000,
};

/** Profil temporaire : laisser finir une épellation avant de déclencher le tour. */
export const SPELLING_FLUX_TURN_CONFIG: FluxTurnConfig = {
  eotThreshold: 0.9,
  eotTimeoutMs: 5_000,
};

/** Courte marge de résolution, distincte du timeout EOT maximal de Flux. */
export const FLUX_SPELLING_EOT_GRACE_MS = 650;

function readConfiguredNumber(envName: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function getBaseFluxTurnConfig(): FluxTurnConfig {
  return {
    eotThreshold: readConfiguredNumber(
      'DEEPGRAM_EOT_THRESHOLD',
      DEFAULT_FLUX_TURN_CONFIG.eotThreshold,
      0.5,
      1,
    ),
    eotTimeoutMs: readConfiguredNumber(
      'DEEPGRAM_EOT_TIMEOUT_MS',
      DEFAULT_FLUX_TURN_CONFIG.eotTimeoutMs,
      500,
      60_000,
    ),
  };
}

function cloneFluxTurnConfig(config: FluxTurnConfig): FluxTurnConfig {
  return { ...config };
}

function sameFluxTurnConfig(left: FluxTurnConfig, right: FluxTurnConfig): boolean {
  return (
    left.eotThreshold === right.eotThreshold &&
    left.eotTimeoutMs === right.eotTimeoutMs &&
    left.eagerEotThreshold === right.eagerEotThreshold
  );
}

function ensureDeepgramTurnConfig(session: CallSession): DeepgramTurnConfigState {
  if (!session.deepgramTurnConfig) {
    const base = getBaseFluxTurnConfig();
    session.deepgramTurnConfig = {
      base,
      desired: cloneFluxTurnConfig(base),
      applied: null,
      spellingActive: false,
      previous: null,
    };
  }
  return session.deepgramTurnConfig;
}

function configuredModel(session: CallSession): string {
  return session.deepgramModel ?? process.env.DEEPGRAM_MODEL ?? DEEPGRAM_DEFAULT_MODEL;
}

function isFluxSession(session: CallSession): boolean {
  return configuredModel(session).startsWith('flux-');
}

/**
 * Construit l'URL WebSocket Deepgram selon le model demandé.
 * Exporté pour les tests — n'est PAS censé être appelé directement par
 * d'autres modules du runtime (utiliser connectDeepgramFlux à la place).
 *
 * @param model model_id Deepgram ('flux-general-multi' | 'nova-3' | ...)
 * @param codec codec Telnyx (PCMA = alaw, PCMU = mulaw)
 * @returns URL complète avec query string (model, encoding, sample_rate, language_hint/keyterms...)
 */
export function buildDeepgramUrl(
  model: string,
  codec: 'PCMA' | 'PCMU',
  turnConfig: FluxTurnConfig = getBaseFluxTurnConfig(),
): string {
  const isAlaw = codec === 'PCMA';
  const isFlux = model.startsWith('flux-');
  const apiUrl = isFlux ? DEEPGRAM_API_URL_FLUX : DEEPGRAM_API_URL_NOVA;
  const params = new URLSearchParams({
    model,
    encoding: isAlaw ? 'alaw' : 'mulaw',
    sample_rate: '8000',
  });

  if (isFlux) {
    // Flux v2 uses language_hint for the multilingual model. The Nova v1
    // `language`/`interim_results` parameters are not valid on /v2/listen.
    params.set('language_hint', 'fr');
    params.set('eot_threshold', String(turnConfig.eotThreshold));
    params.set('eot_timeout_ms', String(turnConfig.eotTimeoutMs));
    if (turnConfig.eagerEotThreshold !== undefined) {
      params.set('eager_eot_threshold', String(turnConfig.eagerEotThreshold));
    }
  } else {
    // Nova v1 accepts the explicit channel count; Flux v2 rejects the
    // `channels` query parameter (the Telnyx stream is already mono).
    params.set('channels', '1');
    params.set('language', 'fr');
    params.set('interim_results', 'true');
    params.set('punctuate', 'true');
    params.set('smart_format', 'true');
    params.set('endpointing', '150');
    params.set('utterance_end_ms', '1000');
  }

  // Boost critical reservation vocabulary for FR (Flux v2 model)
  if (isFlux) {
    const keyterms = [
      'réservation',
      'personnes',
      'soir',
      'heures',
      'midi',
      'couverts',
      'deux',
      'deux k',
      'double',
      'double k',
      'épeler',
      'au nom de',
      'trois',
      'quatre',
      'cinq',
      'six',
      'sept',
      'huit',
      'neuf',
      'dix',
    ];
    for (const term of keyterms) {
      params.append('keyterm', term);
    }
  }

  return `${apiUrl}?${params}`;
}

interface DeepgramThresholds {
  eot_threshold?: number;
  eot_timeout_ms?: number;
  eager_eot_threshold?: number;
}

function configFromThresholds(
  thresholds: DeepgramThresholds | undefined,
  fallback: FluxTurnConfig,
): FluxTurnConfig {
  if (!thresholds) return cloneFluxTurnConfig(fallback);
  return {
    eotThreshold:
      typeof thresholds.eot_threshold === 'number'
        ? thresholds.eot_threshold
        : fallback.eotThreshold,
    eotTimeoutMs:
      typeof thresholds.eot_timeout_ms === 'number'
        ? thresholds.eot_timeout_ms
        : fallback.eotTimeoutMs,
    ...(typeof thresholds.eager_eot_threshold === 'number'
      ? { eagerEotThreshold: thresholds.eager_eot_threshold }
      : fallback.eagerEotThreshold !== undefined
        ? { eagerEotThreshold: fallback.eagerEotThreshold }
        : {}),
  };
}

function deepgramThresholds(config: FluxTurnConfig): DeepgramThresholds {
  return {
    eot_threshold: config.eotThreshold,
    eot_timeout_ms: config.eotTimeoutMs,
    ...(config.eagerEotThreshold !== undefined
      ? { eager_eot_threshold: config.eagerEotThreshold }
      : {}),
  };
}

/** Envoie Configure sans attendre d'acknowledgement ni bloquer le pipeline audio. */
export function sendFluxConfigure(session: CallSession, config: FluxTurnConfig): boolean {
  const ws = session.deepgramWs;
  if (!ws || ws.readyState !== WebSocket.OPEN || !isFluxSession(session)) return false;

  try {
    ws.send(JSON.stringify({ type: 'Configure', thresholds: deepgramThresholds(config) }));
    return true;
  } catch (err) {
    logger.warn(
      { err, callId: session.callControlId },
      '[deepgram] Configure could not be sent; keeping the previous turn profile',
    );
    return false;
  }
}

/** Active ou restaure le profil Flux d'épellation sur la connexion existante. */
export function setDeepgramSpellingProfile(session: CallSession, active: boolean): void {
  const state = ensureDeepgramTurnConfig(session);
  if (active && !state.spellingActive) {
    state.previous = cloneFluxTurnConfig(state.applied ?? state.base);
  }
  const desired = active ? SPELLING_FLUX_TURN_CONFIG : (state.previous ?? state.base);
  const alreadyDesired =
    state.spellingActive === active && sameFluxTurnConfig(state.desired, desired);
  state.spellingActive = active;
  state.desired = cloneFluxTurnConfig(desired);
  if (!active) state.previous = null;
  if (alreadyDesired) return;
  // Configure est best-effort : une reconnexion renverra le profil désiré dans
  // le handler `open`, et un échec d'ack n'interrompt jamais le tour vocal.
  sendFluxConfigure(session, state.desired);
}

function clearPendingFluxEndOfTurn(session: CallSession): void {
  if (session.deepgramEndOfTurnTimer) {
    clearTimeout(session.deepgramEndOfTurnTimer);
    session.deepgramEndOfTurnTimer = null;
  }
  session.pendingDeepgramEndOfTurn = null;
}

function transcriptWords(transcript: string): string[] {
  return transcript.trim().split(/\s+/u).filter(Boolean);
}

/**
 * Flux peut renvoyer un transcript complet après TurnResumed, mais le fallback
 * de test/transport peut ne fournir que le segment ajouté. Dans les deux cas,
 * conserver le préfixe déjà finalisé et éviter les doublons de recouvrement.
 */
function mergeFluxTranscripts(previous: string, next: string): string {
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

function schedulePendingFluxEndOfTurn(session: CallSession): void {
  if (session.deepgramEndOfTurnTimer) {
    clearTimeout(session.deepgramEndOfTurnTimer);
  }
  session.deepgramEndOfTurnTimer = setTimeout(() => {
    const pending = session.pendingDeepgramEndOfTurn;
    session.pendingDeepgramEndOfTurn = null;
    session.deepgramEndOfTurnTimer = null;
    if (pending) {
      dispatchFluxUtteranceEnd(session, pending.transcript, {
        ...(pending.words ? { words: pending.words } : {}),
        ...(pending.endOfTurnConfidence !== undefined
          ? { endOfTurnConfidence: pending.endOfTurnConfidence }
          : {}),
        ...(pending.trigger ? { trigger: pending.trigger } : {}),
      });
    }
  }, FLUX_SPELLING_EOT_GRACE_MS);
}

function flushPendingFluxEndOfTurn(session: CallSession): void {
  const pending = session.pendingDeepgramEndOfTurn;
  if (!pending) return;
  if (session.deepgramEndOfTurnTimer) {
    clearTimeout(session.deepgramEndOfTurnTimer);
    session.deepgramEndOfTurnTimer = null;
  }
  session.pendingDeepgramEndOfTurn = null;
  dispatchFluxUtteranceEnd(session, pending.transcript, {
    ...(pending.words ? { words: pending.words } : {}),
    ...(pending.endOfTurnConfidence !== undefined
      ? { endOfTurnConfidence: pending.endOfTurnConfidence }
      : {}),
    ...(pending.trigger ? { trigger: pending.trigger } : {}),
  });
}

/**
 * Pont audio entre Telnyx et Deepgram (Flux v2 par défaut, Nova-3 v1 en fallback).
 *
 * - Reçoit l'audio PCMU/PCMA de Telnyx
 * - Le forwarde à Deepgram avec model=flux-general-multi (Flux v2)
 * - Retourne les événements de transcription (UtteranceEnd, EagerEndOfTurn, etc.)
 *
 * Override via DEEPGRAM_MODEL env var :
 *   - flux-general-multi (défaut, recommandé — détection de turn + interim + EagerEndOfTurn)
 *   - nova-3 (fallback, v1, plus stable mais sans FluxEvent sémantiques)
 *
 * L'URL est sélectionnée automatiquement selon le model :
 *   - flux-* → v2/listen
 *   - nova-3 → v1/listen
 */
export function connectDeepgramFlux(
  session: CallSession,
  onEvent?: (event: FluxEvent) => void,
): Promise<void> {
  // Si on a passé un callback, l'enregistrer
  if (onEvent) session.onDeepgramEvent = onEvent;

  // Si déjà connecté ou en cours de connexion, on retourne la promise existante
  if (session.deepgramReady) return session.deepgramReady;

  const model = process.env.DEEPGRAM_MODEL ?? DEEPGRAM_DEFAULT_MODEL;
  session.deepgramModel = model;
  const turnConfig = ensureDeepgramTurnConfig(session);
  const apiKey = process.env.DEEPGRAM_API_KEY ?? '';
  if (!apiKey || process.env.NODE_ENV === 'test') {
    session.deepgramReady = Promise.resolve();
    return session.deepgramReady;
  }

  logger.info({ callId: session.callControlId }, '[deepgram] Initiating connection');
  const promise = new Promise<void>((resolve, reject) => {
    const url = buildDeepgramUrl(model, session.codec, turnConfig.base);
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    session.deepgramWs = ws;

    ws.on('open', () => {
      writeDebugLog(
        `[deepgram] Connected successfully for call ${session.callControlId}. Sending ${session.audioBuffer.length} buffered chunks`,
      );
      logger.info({ callId: session.callControlId }, '[deepgram] Connected for call');

      // Envoyer tous les buffers audio accumulés pendant la connexion
      for (const chunk of session.audioBuffer) {
        ws.send(chunk);
      }
      session.audioBuffer = [];

      // Un WebSocket fraîchement reconnecté ne connaît pas l'ancien profil.
      // Le profil désiré est renvoyé immédiatement, sans attendre sa réponse.
      turnConfig.applied = null;
      sendFluxConfigure(session, turnConfig.desired);

      resolve();
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as DeepgramMessage;
        handleDeepgramMessage(session, msg);
      } catch (err) {
        writeDebugLog(`[deepgram] Parse error: ${(err as Error).message}`, err);
        logger.error({ err, callId: session.callControlId }, '[deepgram] Parse error');
      }
    });

    ws.on('error', (err: Error) => {
      writeDebugLog(`[deepgram] WebSocket error for call ${session.callControlId}`, err);
      logger.error({ err, callId: session.callControlId }, `[deepgram] Error: ${err.message}`);
      voiceProviderErrorsTotal.inc({ provider: 'deepgram', type: 'ws_error' });

      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'deepgram-bridge', event: 'websocket-error' },
          extra: { callId: session.callControlId },
        });
      }

      session.deepgramWs = null;
      session.deepgramReady = null;
      reject(err);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      writeDebugLog(
        `[deepgram] WebSocket closed for call ${session.callControlId}: code=${code} reason=${reason.toString()}`,
      );
      logger.info(
        { callId: session.callControlId, code, reason: reason.toString() },
        '[deepgram] Connection closed',
      );
      session.deepgramWs = null;
      session.deepgramReady = null;
    });
  });

  session.deepgramReady = promise;
  return promise;
}

/**
 * Limite du buffer audio Deepgram (en chunks) avant de drop les plus vieux.
 * ~400 chunks = ~8s d'audio à 50chunks/s (20ms par chunk)
 * Augmenté de 200→400 pour éviter la perte d'audio si Deepgram met >4s à se connecter.
 */
export const DEEPGRAM_AUDIO_BUFFER_MAX = 400;

// Délais de départ calibrés pour une conversation téléphonique : ils restent
// perceptiblement réactifs, tout en laissant passer les pauses naturelles.
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
  // « Ok donc », « du coup » ou « mais » sont des relances inachevées très
  // fréquentes à l'oral. Répondre après 650 ms coupe l'appelant en deux tours.
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

/**
 * Envoie un chunk audio Telnyx à Deepgram.
 * Convertit PCMU/L16 → format attendu par Deepgram.
 */
export function sendAudioToDeepgram(session: CallSession, audioPayload: string): void {
  const audioBuffer = Buffer.from(audioPayload, 'base64');

  // Déclencher la connexion Deepgram si pas encore initiée
  if (!session.deepgramWs && !session.deepgramReady) {
    connectDeepgramFlux(session).catch((err) => {
      logger.error(
        { err, callId: session.callControlId },
        '[deepgram] Connection failed in sendAudioToDeepgram',
      );
    });
  }

  const isOpen = session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN;

  if (isOpen) {
    session.deepgramWs!.send(audioBuffer);
  } else {
    // Bufferiser en attendant que Deepgram soit connecté
    // Limiter la taille du buffer pour éviter le leak mémoire
    if (session.audioBuffer.length >= DEEPGRAM_AUDIO_BUFFER_MAX) {
      session.audioBuffer.shift(); // drop le plus vieux chunk
    }
    session.audioBuffer.push(audioBuffer);
  }
}

/**
 * Ferme la connexion Deepgram proprement.
 */
export function closeDeepgram(session: CallSession): void {
  clearPendingFluxEndOfTurn(session);
  if (session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN) {
    if (isFluxSession(session)) {
      session.deepgramWs.send(JSON.stringify({ type: 'CloseStream' }));
      return;
    }
    // Envoie un finalize + done
    session.deepgramWs.send(JSON.stringify({ type: 'Finalize' }));
    setTimeout(() => {
      if (session.deepgramWs?.readyState === WebSocket.OPEN) {
        session.deepgramWs.send(JSON.stringify({ type: 'Close' }));
      }
    }, DEEPGRAM_CLOSE_DELAY_MS);
  }
}

// ─── Parsing des messages Deepgram Flux ──────────────────────────

export interface DeepgramMessage {
  /** Legacy v1/Nova messages use `type`; Flux v2 uses `event`. */
  type?: string;
  event?: string;
  /** Flux v2 puts the transcript at the top level. */
  transcript?: string;
  message?: string;
  error?: string;
  request_id?: string;
  thresholds?: DeepgramThresholds;
  applied?: DeepgramThresholds;
  config?: DeepgramThresholds;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript: string;
      confidence: number;
      words?: Array<{
        word?: string;
        punctuated_word?: string;
        confidence?: number;
        start?: number;
        end?: number;
      }>;
    }>;
  };
  words?: Array<{
    word?: string;
    punctuated_word?: string;
    confidence?: number;
    start?: number;
    end?: number;
  }>;
  utterance?: {
    end?: number;
    start?: number;
  };
  speech_final?: boolean;
  end_of_turn_confidence?: number;
  trigger?: string;
}

function getDeepgramTranscript(msg: DeepgramMessage): string {
  if (msg.transcript?.trim()) return msg.transcript;
  return msg.channel?.alternatives?.[0]?.transcript ?? '';
}

function getDeepgramWords(msg: DeepgramMessage): FluxWord[] | undefined {
  const words = msg.words ?? msg.channel?.alternatives?.[0]?.words;
  if (!words?.length) return undefined;
  const mapped = words
    .filter((word): word is typeof word & { word: string } => typeof word.word === 'string')
    .map((word) => ({
      word: word.word,
      ...(word.punctuated_word ? { punctuatedWord: word.punctuated_word } : {}),
      ...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
      ...(typeof word.start === 'number' ? { start: word.start } : {}),
      ...(typeof word.end === 'number' ? { end: word.end } : {}),
    }));
  return mapped.length ? mapped : undefined;
}

function turnMetadata(msg: DeepgramMessage): {
  words?: FluxWord[];
  endOfTurnConfidence?: number;
  trigger?: string;
} {
  const words = getDeepgramWords(msg);
  return {
    ...(words ? { words } : {}),
    ...(typeof msg.end_of_turn_confidence === 'number'
      ? { endOfTurnConfidence: msg.end_of_turn_confidence }
      : {}),
    ...(msg.trigger ? { trigger: msg.trigger } : {}),
  };
}

function dispatchFluxUtteranceEnd(
  session: CallSession,
  transcript: string,
  metadata: ReturnType<typeof turnMetadata>,
): void {
  if (!transcript.trim()) return;
  logger.info(
    { callId: session.callControlId, transcript: redactPii(transcript.slice(0, 100)) },
    '[deepgram] End of turn',
  );
  session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript, ...metadata });
}

function dispatchNativeFluxEndOfTurn(
  session: CallSession,
  transcript: string,
  metadata: ReturnType<typeof turnMetadata>,
): void {
  const previousTranscript = session.pendingDeepgramEndOfTurn?.transcript ?? session.turnTranscript;
  // Flux garantit que le transcript d'EndOfTurn est celui du tour complet et
  // correspond au dernier EagerEndOfTurn. Il est donc la source de vérité :
  // fusionner un ancien snapshot pourrait réintroduire une lettre retirée par
  // Flux lors de sa résolution finale.
  const completeTranscript = transcript.trim() || previousTranscript;
  clearPendingFluxEndOfTurn(session);
  session.turnTranscript = '';
  const spellingProfileActive =
    isNameCollectionBlocking(session) || session.conversation.pendingQuestion === 'customerName';
  if (!spellingProfileActive) {
    dispatchFluxUtteranceEnd(session, completeTranscript, metadata);
    return;
  }

  // Flux a déjà borné le silence avec eot_timeout_ms. Cette grâce de résolution
  // est volontairement courte : elle évite une réponse au milieu de deux lettres
  // sans imposer les cinq secondes maximales à chaque tour.
  session.pendingDeepgramEndOfTurn = { transcript: completeTranscript, ...metadata };
  schedulePendingFluxEndOfTurn(session);
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
  if (session.abortController) {
    session.abortController.abort();
    session.abortController = null;
  }
  mgr.handleBargeIn(session);
}

/**
 * Dispatch un message Deepgram brut vers les bons handlers.
 * Exporté pour les tests (le message arrive normalement via le `ws.on('message')`
 * de connectDeepgramFlux). Le test injecte directement le message parsé
 * pour vérifier la logique de barge-in, smart-timer, spéculation, etc.
 */
export function handleDeepgramMessage(session: CallSession, msg: DeepgramMessage): void {
  const mgr = CallSessionManager.getInstance();
  // Flux v2 emits `event` (StartOfTurn, EndOfTurn, ...), while the legacy
  // Nova-compatible path emits `type` (Results, UtteranceEnd, ...).
  const eventType = msg.event ?? msg.type;

  switch (eventType) {
    case 'ConfigureSuccess': {
      const state = ensureDeepgramTurnConfig(session);
      const config = configFromThresholds(
        msg.thresholds ?? msg.applied ?? msg.config,
        state.desired,
      );
      state.applied = config;
      session.onDeepgramEvent?.({ type: 'ConfigureSuccess', config });
      break;
    }

    case 'ConfigureFailure': {
      const message = msg.message ?? msg.error ?? 'Deepgram rejected the requested configuration';
      logger.warn(
        { callId: session.callControlId, message },
        '[deepgram] Configure failed; keeping the previous turn profile',
      );
      session.onDeepgramEvent?.({ type: 'ConfigureFailure', message });
      break;
    }

    case 'StartOfTurn':
    case 'UtteranceStart': {
      logger.info({ callId: session.callControlId }, '[deepgram] Utterance start');
      // Un EOT différé contient déjà des lettres finalisées : un nouveau
      // StartOfTurn ne doit pas les jeter avant leur remise au contrôleur.
      flushPendingFluxEndOfTurn(session);
      if (eventType === 'StartOfTurn') {
        session.turnTranscript = getDeepgramTranscript(msg).trim();
      }

      // Flux guarantees a non-empty transcript on StartOfTurn, making it the
      // reliable barge-in signal while Cartesia is speaking.
      handleBargeInFromTranscript(session, mgr, getDeepgramTranscript(msg));

      // Annuler toute spéculation en cours (le caller continue)
      session.speculativeLlm = null;
      session.speculativeResult = null;
      session.speculativeTranscript = '';

      session.onDeepgramEvent?.({ type: 'UtteranceStart' });
      break;
    }

    case 'TurnResumed': {
      const resumedTranscript = getDeepgramTranscript(msg);
      const previousTranscript =
        session.pendingDeepgramEndOfTurn?.transcript ?? session.turnTranscript;
      const mergedTranscript = mergeFluxTranscripts(previousTranscript, resumedTranscript);
      if (mergedTranscript) session.turnTranscript = mergedTranscript;
      if (session.pendingDeepgramEndOfTurn) {
        session.pendingDeepgramEndOfTurn.transcript = mergedTranscript;
        schedulePendingFluxEndOfTurn(session);
      }
      // Le caller continue après une pause → annuler la spéculation et le LLM en cours
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }
      session.speculativeLlm = null;
      session.speculativeResult = null;
      session.speculativeTranscript = '';
      session.onDeepgramEvent?.({ type: 'SpeechResumed' });
      break;
    }

    case 'SpeechResumed':
      clearPendingFluxEndOfTurn(session);
      // Le caller continue après une pause → annuler la spéculation et le LLM en cours
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }
      session.speculativeLlm = null;
      session.speculativeResult = null;
      session.speculativeTranscript = '';
      session.onDeepgramEvent?.({ type: 'SpeechResumed' });
      break;

    case 'EagerEndOfTurn': {
      const transcript = getDeepgramTranscript(msg);
      if (transcript.trim()) {
        session.turnTranscript = mergeFluxTranscripts(session.turnTranscript, transcript);
        logger.info(
          { callId: session.callControlId, transcript: redactPii(transcript.slice(0, 100)) },
          '[deepgram] Eager end of turn',
        );
        session.onDeepgramEvent?.({ type: 'EagerEndOfTurn', transcript, ...turnMetadata(msg) });
      }
      break;
    }

    case 'EndOfTurn': {
      // Flux v2 already provides the complete turn transcript at the top level.
      // Do not wait for a Nova `Results`/`speech_final` message, which Flux does
      // not emit and which previously left the live call silent.
      const transcript = getDeepgramTranscript(msg);
      if (session.speechFinalTimer) {
        clearTimeout(session.speechFinalTimer);
        session.speechFinalTimer = null;
      }
      dispatchNativeFluxEndOfTurn(session, transcript, turnMetadata(msg));
      break;
    }

    case 'UtteranceEnd': {
      const transcript = getDeepgramTranscript(msg);
      if (transcript.trim()) {
        logger.info(
          { callId: session.callControlId, transcript: redactPii(transcript.slice(0, 100)) },
          '[deepgram] Utterance end',
        );
        session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript, ...turnMetadata(msg) });
      }
      break;
    }

    case 'Results':
    case 'FinalTranscript': {
      const transcript = getDeepgramTranscript(msg);
      const isFinal = msg.is_final === true;
      const isSpeechFinal = msg.speech_final === true;
      const confidence = msg.channel?.alternatives?.[0]?.confidence ?? 0;

      // Barge-in: si on est en train de parler et que l'utilisateur dit quelque chose (transcript non vide)
      handleBargeInFromTranscript(session, mgr, transcript);

      if (isFinal) {
        if (transcript.trim()) {
          session.turnTranscript += (session.turnTranscript ? ' ' : '') + transcript.trim();
          logger.info(
            {
              callId: session.callControlId,
              segment: redactPii(transcript.slice(0, 100)),
              speechFinal: isSpeechFinal,
            },
            '[deepgram] Segment finalized',
          );
        }

        if (isSpeechFinal) {
          // speech_final reçu → annuler le timer de fallback et fire immédiatement
          if (session.speechFinalTimer) {
            clearTimeout(session.speechFinalTimer);
            session.speechFinalTimer = null;
          }

          if (session.turnTranscript.trim()) {
            const fullTurnTranscript = session.turnTranscript;
            session.turnTranscript = '';
            logger.info(
              {
                callId: session.callControlId,
                transcript: redactPii(fullTurnTranscript.slice(0, 100)),
              },
              '[deepgram] Speech final (turn completed)',
            );
            session.onDeepgramEvent?.({
              type: 'UtteranceEnd',
              transcript: fullTurnTranscript,
              ...turnMetadata(msg),
            });
          }
        } else if (session.turnTranscript.trim()) {
          // is_final=true avec du contenu MAIS speech_final=false.
          // Le délai garde une marge de respiration après la ponctuation et protège
          // les présentations incomplètes, sans attendre inutilement après un silence.
          const endpoint = getSmartEndpointDelay(session.turnTranscript);
          // Flux peut finaliser « Bonjour, je suis Martin » avant la suite de la phrase.
          // Cette forme reçoit une courte marge supplémentaire, sans imposer un silence
          // artificiel de plusieurs secondes à l'appelant.
          const { timeoutMs } = endpoint;

          // Reset le timer existant (nouveau segment reçu = l'user continue peut-être)
          if (session.speechFinalTimer) {
            clearTimeout(session.speechFinalTimer);
          }

          writeDebugLog(
            `[deepgram] Starting ${timeoutMs}ms smart timer (reason=${endpoint.reason})`,
          );
          session.speechFinalTimer = setTimeout(() => {
            if (session.turnTranscript.trim()) {
              const fallbackTranscript = session.turnTranscript;
              session.turnTranscript = '';
              session.speechFinalTimer = null;
              writeDebugLog(
                `[deepgram] Smart timer fired! (${timeoutMs}ms) UtteranceEnd: "${redactPii(fallbackTranscript.slice(0, 80))}"`,
              );
              logger.info(
                {
                  callId: session.callControlId,
                  transcript: redactPii(fallbackTranscript.slice(0, 100)),
                  timeoutMs,
                  endpointReason: endpoint.reason,
                },
                '[deepgram] Speech final (smart timer)',
              );
              session.onDeepgramEvent?.({
                type: 'UtteranceEnd',
                transcript: fallbackTranscript,
                ...turnMetadata(msg),
              });
            }
          }, timeoutMs);
        }
      }

      // Fallback: si speech_final=true mais isFinal=false, forcer UtteranceEnd
      if (!isFinal && isSpeechFinal && session.turnTranscript.trim()) {
        if (session.speechFinalTimer) {
          clearTimeout(session.speechFinalTimer);
          session.speechFinalTimer = null;
        }
        const fullTurnTranscript = session.turnTranscript;
        session.turnTranscript = '';
        logger.info(
          {
            callId: session.callControlId,
            transcript: redactPii(fullTurnTranscript.slice(0, 100)),
          },
          '[deepgram] Speech final (forced fallback)',
        );
        session.onDeepgramEvent?.({
          type: 'UtteranceEnd',
          transcript: fullTurnTranscript,
          ...turnMetadata(msg),
        });
      }

      // Reset timer si l'user continue de parler (interim non vide)
      if (!isFinal && transcript.trim() && session.speechFinalTimer) {
        writeDebugLog(`[deepgram] User still speaking, resetting timer`);
        clearTimeout(session.speechFinalTimer);
        session.speechFinalTimer = null;
      }

      // Spéculation LLM : interim stable, confiance > 0.95, au moins 3 mots
      const isSpeculativeEnabled = isSpeculativeLlmEnabled(session);
      const wordCount = transcript.trim().split(/\s+/).length;
      const lastTranscript = session.speculativeTranscript;

      if (
        isSpeculativeEnabled &&
        !isNameCollectionBlocking(session) &&
        session.conversation?.pendingQuestion !== 'customerName' &&
        !isFinal &&
        !session.speculativeLlm &&
        confidence >= 0.95 &&
        wordCount >= 3 &&
        wordCount <= 20 &&
        transcript !== lastTranscript
      ) {
        session.speculativeTranscript = transcript;
        session.onDeepgramEvent?.({
          type: 'InterimHighConfidence',
          transcript,
          ...(getDeepgramWords(msg) ? { words: getDeepgramWords(msg) } : {}),
        });
      }
      break;
    }

    case 'Error': {
      const message = msg.message ?? msg.error ?? 'Unknown Deepgram error';
      logger.error({ callId: session.callControlId, message }, '[deepgram] Provider error');
      session.onDeepgramEvent?.({ type: 'Error', message });
      break;
    }

    default:
      // Ignorer les autres types (interim, etc.)
      break;
  }
}
