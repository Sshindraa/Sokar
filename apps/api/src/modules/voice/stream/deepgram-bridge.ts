import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { CallSession, FluxEvent } from './types';
import { CallSessionManager } from './manager';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { DEEPGRAM_CLOSE_DELAY_MS } from '../../../shared/constants/timeouts.js';
import { isSpeculativeLlmEnabled } from './speculation';
import { redactPii } from './pii-redact';

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

/**
 * Construit l'URL WebSocket Deepgram selon le model demandé.
 * Exporté pour les tests — n'est PAS censé être appelé directement par
 * d'autres modules du runtime (utiliser connectDeepgramFlux à la place).
 *
 * @param model model_id Deepgram ('flux-general-multi' | 'nova-3' | ...)
 * @param codec codec Telnyx (PCMA = alaw, PCMU = mulaw)
 * @returns URL complète avec query string (model, encoding, sample_rate, keyterms...)
 */
export function buildDeepgramUrl(model: string, codec: 'PCMA' | 'PCMU'): string {
  const isAlaw = codec === 'PCMA';
  const isFlux = model.startsWith('flux-');
  const apiUrl = isFlux ? DEEPGRAM_API_URL_FLUX : DEEPGRAM_API_URL_NOVA;
  const params = new URLSearchParams({
    model,
    language: 'fr',
    encoding: isAlaw ? 'alaw' : 'mulaw',
    sample_rate: '8000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '150',
    utterance_end_ms: '1000',
  });

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

  const apiKey = process.env.DEEPGRAM_API_KEY ?? '';
  if (!apiKey || process.env.NODE_ENV === 'test') {
    session.deepgramReady = Promise.resolve();
    return session.deepgramReady;
  }

  logger.info({ callId: session.callControlId }, '[deepgram] Initiating connection');
  const promise = new Promise<void>((resolve, reject) => {
    const model = process.env.DEEPGRAM_MODEL ?? DEEPGRAM_DEFAULT_MODEL;
    const url = buildDeepgramUrl(model, session.codec);
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
  if (session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN) {
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
  type: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript: string; confidence: number }>;
  };
  utterance?: {
    end?: number;
    start?: number;
  };
  speech_final?: boolean;
}

/**
 * Dispatch un message Deepgram brut vers les bons handlers.
 * Exporté pour les tests (le message arrive normalement via le `ws.on('message')`
 * de connectDeepgramFlux). Le test injecte directement le message parsé
 * pour vérifier la logique de barge-in, smart-timer, spéculation, etc.
 */
export function handleDeepgramMessage(session: CallSession, msg: DeepgramMessage): void {
  const mgr = CallSessionManager.getInstance();

  switch (msg.type) {
    case 'UtteranceStart': {
      logger.info({ callId: session.callControlId }, '[deepgram] Utterance start');

      // Annuler toute spéculation en cours (le caller continue)
      session.speculativeLlm = null;
      session.speculativeResult = null;
      session.speculativeTranscript = '';

      session.onDeepgramEvent?.({ type: 'UtteranceStart' });
      break;
    }

    case 'SpeechResumed':
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

    case 'UtteranceEnd': {
      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (transcript.trim()) {
        logger.info(
          { callId: session.callControlId, transcript: redactPii(transcript.slice(0, 100)) },
          '[deepgram] Utterance end',
        );
        session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript });
      }
      break;
    }

    case 'Results':
    case 'FinalTranscript': {
      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
      const isFinal = msg.is_final === true;
      const isSpeechFinal = msg.speech_final === true;
      const confidence = msg.channel?.alternatives?.[0]?.confidence ?? 0;

      // Barge-in: si on est en train de parler et que l'utilisateur dit quelque chose (transcript non vide)
      if (session.state === 'SPEAKING' && transcript.trim().length > 0) {
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
            session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript: fullTurnTranscript });
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
              session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript: fallbackTranscript });
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
        session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript: fullTurnTranscript });
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
        !isFinal &&
        !session.speculativeLlm &&
        confidence >= 0.95 &&
        wordCount >= 3 &&
        wordCount <= 20 &&
        transcript !== lastTranscript
      ) {
        session.speculativeTranscript = transcript;
        session.onDeepgramEvent?.({ type: 'InterimHighConfidence', transcript });
      }
      break;
    }

    default:
      // Ignorer les autres types (interim, etc.)
      break;
  }
}
