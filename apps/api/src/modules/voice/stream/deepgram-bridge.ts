import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { CallSession, FluxEvent } from './types';
import { CallSessionManager } from './manager';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { DEEPGRAM_CLOSE_DELAY_MS } from '../../../shared/constants/timeouts.js';

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
const DEEPGRAM_API_URL_FLUX = 'wss://api.deepgram.com/v2/listen';
const DEEPGRAM_API_URL_NOVA = 'wss://api.deepgram.com/v1/listen';
const DEEPGRAM_DEFAULT_MODEL = 'flux-general-multi';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? '';

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
  const apiUrl = model.startsWith('flux-') ? DEEPGRAM_API_URL_FLUX : DEEPGRAM_API_URL_NOVA;
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

  // Boost critical reservation vocabulary for FR
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

  // Si déjà connecté directement, résoudre immédiatement
  if (session.deepgramWs?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  logger.info({ callId: session.callControlId }, '[deepgram] Initiating connection');
  const promise = new Promise<void>((resolve, reject) => {
    const model = process.env.DEEPGRAM_MODEL ?? DEEPGRAM_DEFAULT_MODEL;
    const url = buildDeepgramUrl(model, session.codec);
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
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
        const msg = JSON.parse(raw.toString());
        writeDebugLog(
          `[deepgram] Message received: type=${msg.type} is_final=${msg.is_final} speech_final=${msg.speech_final} channel_trans="${msg.channel?.alternatives?.[0]?.transcript}"`,
        );
        handleDeepgramMessage(session, msg);
      } catch (err) {
        writeDebugLog(`[deepgram] Parse error in message`, err);
        logger.error({ err, callId: session.callControlId }, '[deepgram] Parse error');
      }
    });

    ws.on('error', (err: Error) => {
      logger.error(
        { err, callId: session.callControlId },
        `[deepgram] Error for call: ${err.message}`,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'deepgram-bridge' },
          extra: { callId: session.callControlId },
        });
      }
      onEvent?.({ type: 'Error', message: err.message });
      reject(err);
    });

    ws.on('close', () => {
      logger.info({ callId: session.callControlId }, '[deepgram] Disconnected for call');
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

/**
 * Envoie un chunk audio Telnyx à Deepgram.
 * Convertit PCMU/L16 → format attendu par Deepgram.
 */
export function sendAudioToDeepgram(session: CallSession, audioPayload: string): void {
  const audioBuffer = Buffer.from(audioPayload, 'base64');

  const isOpen = session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN;
  // (uncomment if log is too verbose, but for now we want full diagnostics)
  // writeDebugLog(`[deepgram] sendAudioToDeepgram: buffer_len=${audioBuffer.length} ws_open=${isOpen}`);

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
      break;

    case 'UtteranceEnd': {
      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (transcript.trim()) {
        logger.info(
          { callId: session.callControlId, transcript: transcript.slice(0, 100) },
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
          { callId: session.callControlId, transcript: transcript.trim() },
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
              segment: transcript.slice(0, 100),
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
              { callId: session.callControlId, transcript: fullTurnTranscript.slice(0, 100) },
              '[deepgram] Speech final (turn completed)',
            );
            session.onDeepgramEvent?.({ type: 'UtteranceEnd', transcript: fullTurnTranscript });
          }
        } else if (session.turnTranscript.trim()) {
          // is_final=true avec du contenu MAIS speech_final=false
          // → Timer intelligent : court si ponctuation détectée, plus long sinon
          // → Le timer se RESET à chaque nouveau segment (évite de couper mid-phrase)
          const endsWithPunctuation = /[.!?]\s*$/.test(session.turnTranscript);
          const timeoutMs = endsWithPunctuation ? 400 : 1500;

          // Reset le timer existant (nouveau segment reçu = l'user continue peut-être)
          if (session.speechFinalTimer) {
            clearTimeout(session.speechFinalTimer);
          }

          writeDebugLog(
            `[deepgram] Starting ${timeoutMs}ms smart timer (punctuation=${endsWithPunctuation})`,
          );
          session.speechFinalTimer = setTimeout(() => {
            if (session.turnTranscript.trim()) {
              const fallbackTranscript = session.turnTranscript;
              session.turnTranscript = '';
              session.speechFinalTimer = null;
              writeDebugLog(
                `[deepgram] Smart timer fired! (${timeoutMs}ms) UtteranceEnd: "${fallbackTranscript.slice(0, 80)}"`,
              );
              logger.info(
                {
                  callId: session.callControlId,
                  transcript: fallbackTranscript.slice(0, 100),
                  timeoutMs,
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
          { callId: session.callControlId, transcript: fullTurnTranscript.slice(0, 100) },
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
      const isSpeculativeEnabled = process.env.SPECULATIVE_LLM_ENABLED === 'true';
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
