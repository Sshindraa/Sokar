/**
 * Handler WebSocket Telnyx Media Stream.
 *
 * Reçoit l'audio en temps réel de Telnyx, le forwarde à Deepgram Flux,
 * reçoit les transcripts, les envoie au LLM, génère du TTS Cartesia,
 * et renvoie l'audio à Telnyx via le stream bidirectionnel.
 *
 * Barge-in : quand le caller parle pendant le TTS, Flux détecte
 * UtteranceStart → on clear le buffer Telnyx → on réécoute.
 */

import type { FastifyInstance } from 'fastify';
import '@fastify/websocket';
import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { TelnyxStreamMessage, FluxEvent, CallSession } from './types';
import { CallSessionManager } from './manager';
import { connectDeepgramFlux, sendAudioToDeepgram, closeDeepgram } from './deepgram-bridge';
import { playFiller } from './fillers-cache';
import { getTtsCached, setTtsCached } from '../tts-cache';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';

const recentTranscripts = new WeakMap<CallSession, { normalized: string; at: number }>();

function writeDebugLog(msg: string, err?: any) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}${err ? ' | ERROR: ' + err.message + '\n' + err.stack : ''}\n`;
  try {
    const logPath = process.env.DEBUG_LOG_PATH || path.join(process.cwd(), 'scratch', 'call_debug.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logMsg);
  } catch (e) {
    logger.error({ err: e }, 'Failed to write debug log');
  }
}

function normalizeTranscriptForDedupe(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkipDuplicateTranscript(session: CallSession, transcript: string): boolean {
  const normalized = normalizeTranscriptForDedupe(transcript);
  if (!normalized) return true;

  const previous = recentTranscripts.get(session);
  const now = Date.now();
  if (previous && previous.normalized === normalized && now - previous.at < 2000) {
    return true;
  }

  recentTranscripts.set(session, { normalized, at: now });
  return false;
}

function isSessionActiveForTts(session: CallSession): boolean {
  return !session.ended && session.state === 'SPEAKING' && session.telnyxWs.readyState === WebSocket.OPEN;
}

function extractRestaurantName(systemPrompt: string): string {
  return systemPrompt
    .split('\n')[0]
    .replace(/^Tu es l'hôte d'accueil et assistant vocal chaleureux de /, '')
    .replace(/^Tu es l'assistant vocal de /, '')
    .replace(/\.$/, '')
    .trim();
}

function stripRepeatedGreeting(text: string, session: CallSession): string {
  const restaurantName = extractRestaurantName(session.systemPrompt);
  const escapedName = restaurantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const greetingPattern = new RegExp(
    `^\\s*Bonjour,\\s*${escapedName}\\s*!\\s*`,
    'i',
  );

  return text.replace(greetingPattern, '').trim();
}

/** Crée ou met à jour un enregistrement Call en base pour un appel Flux */
async function persistFluxCall(session: CallSession): Promise<void> {
  try {
    const { db } = await import('../../../shared/db/client');
    const durationSec = session.createdAt
      ? Math.round((Date.now() - session.createdAt) / 1000)
      : 0;

    await db.call.upsert({
      where: { callSid: session.callLegId },
      update: {
        durationSec,
        transcript: session.transcript || null,
        carrier: 'telnyx',
      },
      create: {
        callSid: session.callLegId,
        restaurantId: session.restaurantId,
        durationSec,
        transcript: session.transcript || null,
        carrier: 'telnyx',
      },
    });
  } catch (err) {
    logger.error({ err, callId: session.callLegId }, '[flux] Failed to persist call');
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, {
        tags: { service: 'handler', action: 'persistFluxCall' },
        extra: { callId: session.callLegId },
      });
    }
  }
}

/** Enregistre la trace de latence en base pour l'appel */
async function persistLatencyTrace(session: CallSession): Promise<void> {
  const trace = session.latencyTrace;
  if (!trace) return;
  try {
    const { db } = await import('../../../shared/db/client');
    const callRecord = await db.call.findUnique({
      where: { callSid: session.callLegId }
    });
    if (!callRecord) {
      writeDebugLog(`[latency] No call record found for leg ${session.callLegId} to attach latency trace`);
      return;
    }
    
    await db.latencyTrace.upsert({
      where: { callId: callRecord.id },
      update: {
        vadEndMs: 0,
        sttFinalMs: trace.sttFinalMs ?? 0,
        llmFirstToken: trace.llmFirstTokenMs ?? null,
        ttsFirstByte: trace.ttsFirstByteMs ?? null,
        audioPlayingMs: trace.totalE2eMs ?? null,
        totalE2eMs: trace.totalE2eMs ?? null,
      },
      create: {
        callId: callRecord.id,
        vadEndMs: 0,
        sttFinalMs: trace.sttFinalMs ?? 0,
        llmFirstToken: trace.llmFirstTokenMs ?? null,
        ttsFirstByte: trace.ttsFirstByteMs ?? null,
        audioPlayingMs: trace.totalE2eMs ?? null,
        totalE2eMs: trace.totalE2eMs ?? null,
      }
    });
    writeDebugLog(`[latency] Saved latency trace for call ${callRecord.id}: E2E ${trace.totalE2eMs}ms`);
  } catch (err: any) {
    writeDebugLog(`[latency] Failed to persist latency trace`, err);
    logger.error({ err, callId: session.callLegId }, '[latency] Failed to persist latency trace');
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, {
        tags: { service: 'handler', action: 'persistLatencyTrace' },
        extra: { callId: session.callLegId },
      });
    }
  }
}

/**
 * Enregistre la route WebSocket pour le media stream Telnyx.
 * Utilise @fastify/websocket pour la gestion des connexions WS.
 */
export function registerMediaStreamRoutes(app: FastifyInstance): void {
  app.get('/voice/stream/:callId', { websocket: true }, (socket, req) => {
    const callId = (req.params as any).callId as string;
    const mgr = CallSessionManager.getInstance();

    logger.info({ callId }, '[stream] New Telnyx WS connection for call');

    // Récupérer la session créée par call.initiated
    let session: CallSession | undefined;

    socket.on('message', (raw: Buffer) => {
      try {
        const msg: TelnyxStreamMessage = JSON.parse(raw.toString());
        session = handleTelnyxMessage(msg, callId, socket, mgr) ?? session;
      } catch (err) {
        logger.error({ err, callId }, '[stream] Parse error');
      }
    });

    socket.on('close', () => {
      logger.info({ callId }, '[stream] Telnyx WS closed');
      if (session) {
        session.ended = true;
        session.state = 'IDLE';
        session.isSpeaking = false;
        // Persister les traces avant cleanup
        persistLatencyTrace(session);
        persistFluxCall(session);
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
    });

    socket.on('error', (err: Error) => {
      logger.error({ err, callId }, `[stream] Error for call: ${err.message}`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'handler', event: 'websocket-error' },
          extra: { callId },
        });
      }
      if (session) {
        session.ended = true;
        session.state = 'IDLE';
        session.isSpeaking = false;
        persistLatencyTrace(session);
        persistFluxCall(session);
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
    });
  });
}

/**
 * Gère chaque message du WebSocket Telnyx.
 * Retourne la session mise à jour.
 */
function handleTelnyxMessage(
  msg: TelnyxStreamMessage,
  callId: string,
  socket: WebSocket,
  mgr: CallSessionManager,
): CallSession | undefined {
  switch (msg.event) {
    case 'connected':
      logger.info({ callId }, '[stream] Telnyx connected');
      return;

    case 'start': {
      const start = msg.start!;
      writeDebugLog(`[stream] Received start event for call ${start.call_control_id}`);
      logger.info({ callId: start.call_control_id, from: start.from, encoding: start.media_format.encoding }, '[stream] Start call');

      const session = mgr.get(start.call_control_id);
      if (!session) {
        writeDebugLog(`[stream] No session found for ${start.call_control_id}`);
        logger.warn({ callId: start.call_control_id }, '[stream] No session found for start event');
        return;
      }

      // Assigner le WebSocket Telnyx à la session (manquant — cause du silence)
      session.telnyxWs = socket;

      // Deepgram est déjà en cours de connexion (pre-warmé dans call.initiated)
      session.onDeepgramEvent = (event: FluxEvent) => handleFluxEvent(event, session, mgr);
      session.deepgramReady?.then(() => {
        writeDebugLog(`[stream] Deepgram ready for ${start.call_control_id}`);
        logger.info({ callId: start.call_control_id }, '[stream] Deepgram ready');
      }).catch((err) => {
        writeDebugLog(`[stream] Deepgram pre-warm was not ready`, err);
        logger.error({ err, callId: start.call_control_id }, `[stream] Deepgram was not ready: ${err.message}`);
        if (process.env.SENTRY_DSN) {
          Sentry.captureException(err, {
            tags: { service: 'handler', action: 'deepgram-ready' },
            extra: { callId: start.call_control_id },
          });
        }
      });

      // Jouer le message d'accueil immédiatement (ne dépend pas de Deepgram)
      const restaurantName = extractRestaurantName(session.systemPrompt);

      const greeting = `Bonjour, ${restaurantName} !`;

      writeDebugLog(`[stream] Speaking greeting: "${greeting}"`);
      mgr.transition(session, 'SPEAKING');
      speakTtsStreamed(session, greeting)
        .then(() => {
          writeDebugLog(`[stream] Greeting spoken successfully, transitioning to LISTENING`);
          mgr.transition(session, 'LISTENING');
        })
        .catch((err) => {
          writeDebugLog(`[stream] Greeting TTS failed`, err);
          logger.error({ err, callId: session.callControlId }, '[stream] Initial greeting TTS failed');
          if (process.env.SENTRY_DSN) {
            Sentry.captureException(err, {
              tags: { service: 'handler', action: 'greeting-tts' },
              extra: { callId: session.callControlId },
            });
          }
          mgr.transition(session, 'LISTENING');
        });

      return session;
    }

    case 'media': {
      const payload = msg.media?.payload;
      if (!payload) return;

      const session = mgr.get(callId);
      if (!session) return session;

      // Forwarder l'audio à Deepgram
      sendAudioToDeepgram(session, payload);

      return session;
    }

    case 'stop': {
      logger.info({ callId }, '[stream] Telnyx stream stop');
      const session = mgr.get(callId);
      if (session) {
        session.ended = true;
        session.state = 'IDLE';
        session.isSpeaking = false;
        persistLatencyTrace(session);
        persistFluxCall(session);
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
      return;
    }

    case 'dtmf':
      return;

    case 'error':
      logger.error({ callId, msg }, '[stream] Telnyx error event');
      if (process.env.SENTRY_DSN) {
        const errorDetail = new Error(`Telnyx error event for call ${callId}`);
        Sentry.captureException(errorDetail, {
          tags: { service: 'handler', event: 'telnyx-error' },
          extra: { callId, payload: msg },
        });
      }
      return;

    default:
      return;
  }
}

/**
 * Gère les événements provenant de Deepgram Flux.
 */
function handleFluxEvent(
  event: FluxEvent,
  session: CallSession,
  mgr: CallSessionManager,
): void {
  switch (event.type) {
    case 'UtteranceStart': {
      // Annuler toute requête LLM en cours (le caller continue de parler)
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }

      // Si on était en spéculation (PROCESSING), le caller continue → reset
      if (session.state === 'PROCESSING') {
        session.speculativeLlm = null;
        session.speculativeResult = null;
        mgr.transition(session, 'LISTENING');
      } else if (session.state === 'IDLE') {
        mgr.transition(session, 'LISTENING');
      }
      break;
    }

    case 'InterimHighConfidence': {
      // Spéculation LLM : lancer le LLM sans attendre la fin de l'utterance
      // Stocker la promise pour la réutiliser si l'utterance finale correspond
      if (process.env.SPECULATIVE_LLM_ENABLED !== 'true') break;
      if (session.state !== 'LISTENING' && session.state !== 'IDLE') break;

      if (!session.latencyTrace) {
        session.latencyTrace = {
          startTime: Date.now(),
          sttFinalMs: 0,
        };
      }

      // Utiliser la transition du manager pour rester cohérent avec la state machine
      mgr.transition(session, 'PROCESSING'); // transition optimiste
      session.speculativeLlm = mgr.processUtterance(session, event.transcript)
        .then((response) => {
          session.speculativeResult = response;
          return response;
        })
        .catch((err) => {
          logger.error({ err, callId: session.callControlId }, `[speculative] LLM failed: ${err.message}`);
          if (process.env.SENTRY_DSN) {
            Sentry.captureException(err, {
              tags: { service: 'handler', action: 'speculative-llm' },
              extra: { callId: session.callControlId, transcript: event.transcript },
            });
          }
          session.speculativeLlm = null;
          session.speculativeResult = null;
          return '';
        });
      break;
    }

    case 'UtteranceEnd': {
      if (!session.latencyTrace) {
        session.latencyTrace = {
          startTime: Date.now(),
          sttFinalMs: 0,
        };
      }

      // Cumuler le transcript pour persistance
      session.transcript += (session.transcript ? ' ' : '') + event.transcript;

      const isSpeculativeEnabled = process.env.SPECULATIVE_LLM_ENABLED === 'true';
      const speculativeTranscript = session.speculativeTranscript;

      if (
        isSpeculativeEnabled &&
        session.speculativeLlm &&
        speculativeTranscript &&
        transcriptsMatch(speculativeTranscript, event.transcript)
      ) {
        // La spéculation est valide → utiliser le résultat en cache
        logger.info({ callId: session.callControlId }, '[speculative] Match! Using cached LLM response');
        session.speculativeLlm.then(async (response) => {
          if (response) {
            // Vérifier que la session est toujours en attente (pas déjà en train de parler)
            if (session.state !== 'LISTENING' && session.state !== 'IDLE') {
              writeDebugLog(`[speculative] Session state is ${session.state}, skipping speculative speech`);
              return;
            }
            mgr.transition(session, 'SPEAKING');
            await speakTtsStreamed(session, response);
            mgr.transition(session, 'LISTENING');
          }
        });
        session.speculativeLlm = null;
        session.speculativeResult = null;
        session.speculativeTranscript = '';
      } else {
        // Pas de spéculation valide ou mismatch / désactivé !
        if (session.speculativeLlm) {
          logger.info({ callId: session.callControlId, interim: speculativeTranscript, final: event.transcript }, '[speculative] Mismatch or disabled. Clearing speculative state');
          session.speculativeLlm = null;
          session.speculativeResult = null;
          session.speculativeTranscript = '';
          mgr.transition(session, 'LISTENING');
        }

        if (session.state === 'LISTENING' || session.state === 'IDLE') {
          // LLM streaming phrase par phrase
          processTranscriptStreaming(session, event.transcript, mgr);
        }
      }
      break;
    }

    case 'FinalTranscript': {
      break;
    }

    case 'Error': {
      logger.error({ callId: session.callControlId, errorMsg: event.message }, `[flux] Error: ${event.message}`);
      if (process.env.SENTRY_DSN) {
        const err = new Error(`Flux error: ${event.message}`);
        Sentry.captureException(err, {
          tags: { service: 'handler', event: 'flux-error' },
          extra: { callId: session.callControlId },
        });
      }
      speakTtsStreamed(session, "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?");
      mgr.transition(session, 'LISTENING');
      break;
    }
  }
}

/**
 * Vérifie si deux transcripts sont suffisamment proches pour
 * réutiliser un résultat LLM spéculatif.
 *
 * Algorithme : le plus court des deux doit avoir 80%+ de ses mots
 * présents dans le plus long, avec le même ordre.
 * Ça évite les hallucinations sur les transcripts qui changent beaucoup.
 */
function transcriptsMatch(a: string, b: string): boolean {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer  = wordsA.length > wordsB.length ? wordsA : wordsB;

  if (shorter.length < 2) return false;

  let matches = 0;
  let j = 0;
  for (const word of shorter) {
    while (j < longer.length && longer[j] !== word) j++;
    if (j < longer.length && longer[j] === word) {
      matches++;
      j++;
    }
  }

  return matches / shorter.length >= 0.8;
}

/**
 * Traite un transcript : LLM → TTS → envoi à Telnyx.
 * Mode classique (non-streaming) — utilisé par la spéculation et le fallback.
 */
async function processTranscript(
  session: CallSession,
  transcript: string,
  mgr: CallSessionManager,
): Promise<void> {
  if (!transcript.trim()) return;
  if (session.ended || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscript] Session ended or WS closed, skipping transcript`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(`[processTranscript] Skipping duplicate transcript: "${transcript}"`);
    return;
  }

  writeDebugLog(`[processTranscript] Received transcript: "${transcript}"`);
  try {
    session.abortController = new AbortController();
    let responseReceived = false;
    const fillerTimer = setTimeout(() => {
      if (!responseReceived && !session.ended && session.state === 'PROCESSING') {
        writeDebugLog(`[processTranscript] LLM took too long (>400ms). Playing a voice filler...`);
        playFiller(session.telnyxWs, session.personality?.fillerStyle ?? 'CASUAL');
      }
    }, 400);

    writeDebugLog(`[processTranscript] Calling LLM...`);
    const llmResponse = await mgr.processUtterance(session, transcript);
    responseReceived = true;
    clearTimeout(fillerTimer);

    if (session.latencyTrace) {
      session.latencyTrace.llmFirstTokenMs = Date.now() - session.latencyTrace.startTime;
    }
    const ttsResponse = stripRepeatedGreeting(llmResponse, session);
    writeDebugLog(`[processTranscript] LLM responded: "${llmResponse}"`);

    if (!ttsResponse) {
      writeDebugLog(`[processTranscript] LLM response empty after greeting strip, skipping TTS`);
      mgr.transition(session, 'LISTENING');
      return;
    }

    if (!isSessionActiveForTts(session)) {
      writeDebugLog(`[processTranscript] Session inactive after LLM, skipping TTS`);
      return;
    }

    writeDebugLog(`[processTranscript] Starting speakTtsStreamed...`);
    await speakTtsStreamed(session, ttsResponse);
    writeDebugLog(`[processTranscript] Completed speakTtsStreamed successfully`);

    mgr.transition(session, 'LISTENING');
    writeDebugLog(`[processTranscript] Transitioned back to LISTENING`);
  } catch (err: any) {
    writeDebugLog(`[processTranscript] Caught error`, err);
    logger.error({ err, callId: session.callControlId }, `[pipeline] Error: ${err.message}`);
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, {
        tags: { service: 'handler', action: 'processTranscript' },
        extra: { callId: session.callControlId, transcript },
      });
    }
    mgr.transition(session, 'LISTENING');
  } finally {
    session.abortController = null;
  }
}

/**
 * Version streaming : reçoit les phrases du LLM au fur et à mesure
 * et lance le TTS immédiatement sans attendre la réponse complète.
 */
async function processTranscriptStreaming(
  session: CallSession,
  transcript: string,
  mgr: CallSessionManager,
): Promise<void> {
  if (!transcript.trim()) return;
  if (session.ended || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscriptStreaming] Session ended or WS closed, skipping`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(`[processTranscriptStreaming] Skipping duplicate transcript: "${transcript}"`);
    return;
  }

  writeDebugLog(`[processTranscriptStreaming] Starting LLM stream for: "${transcript}"`);

  const ttsPromises: Promise<void>[] = [];

  try {
    session.abortController = new AbortController();
    let firstTokenReceived = false;
    const fillerTimer = setTimeout(() => {
      if (!firstTokenReceived && !session.ended && session.state === 'PROCESSING') {
        writeDebugLog(`[processTranscriptStreaming] LLM took too long (>400ms). Playing a voice filler...`);
        playFiller(session.telnyxWs, session.personality?.fillerStyle ?? 'CASUAL');
      }
    }, 400);

    await mgr.processUtteranceStreaming(session, transcript, (phrase: string) => {
      firstTokenReceived = true;
      clearTimeout(fillerTimer);

      writeDebugLog(`[processTranscriptStreaming] Phrase received: "${phrase}"`);
      if (session.latencyTrace && !session.latencyTrace.llmFirstTokenMs) {
        session.latencyTrace.llmFirstTokenMs = Date.now() - session.latencyTrace.startTime;
      }

      const cleanPhrase = stripRepeatedGreeting(phrase, session);
      if (!cleanPhrase) return;

      if (session.state !== 'SPEAKING') {
        mgr.transition(session, 'SPEAKING');
      }

      if (!isSessionActiveForTts(session)) {
        writeDebugLog(`[processTranscriptStreaming] Session inactive, skipping phrase`);
        return;
      }

      // Lancer TTS en background pour ne pas bloquer le stream LLM
      const ttsPromise = speakTtsStreamed(session, cleanPhrase)
        .catch((err: any) => {
          writeDebugLog(`[processTranscriptStreaming] TTS error for phrase: "${cleanPhrase}"`, err);
        });
      ttsPromises.push(ttsPromise);
    });

    writeDebugLog(`[processTranscriptStreaming] LLM stream ended, waiting for TTS...`);
    await Promise.all(ttsPromises);
    writeDebugLog(`[processTranscriptStreaming] All TTS completed`);

    mgr.transition(session, 'LISTENING');
    writeDebugLog(`[processTranscriptStreaming] Transitioned back to LISTENING`);
  } catch (err: any) {
    writeDebugLog(`[processTranscriptStreaming] Caught error`, err);
    logger.error({ err, callId: session.callControlId }, `[pipeline] Streaming error: ${err.message}`);
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, {
        tags: { service: 'handler', action: 'processTranscriptStreaming' },
        extra: { callId: session.callControlId, transcript },
      });
    }
    mgr.transition(session, 'LISTENING');
  } finally {
    session.abortController = null;
  }
}

/**
 * Ajoute des pauses naturelles dans le texte en forçant la ponctuation.
 * Cartesia sonic-3.5 marque une pause sur les virgules et points.
 */
function addNaturalPauses(text: string): string {
  let result = text
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Forcer un point à la fin si absent
  if (!/[.!?]$/.test(result)) result += '.';

  return result;
}

function cleanTextForTts(text: string): string {
  let cleaned = text;

  // 1. Remove emojis
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '');

  // 2. Remove Markdown bold/italic
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

  // 3. Normalise time patterns (e.g. 19h -> 19 heures)
  cleaned = cleaned.replace(/\b(\d+)\s*h\b/g, '$1 heures');

  // 4. Space out alphanumeric codes (e.g. BB344719 -> B. B. 3. 4. 4. 7. 1. 9.)
  cleaned = cleaned.replace(/\b([A-Z0-9]{5,})\b/g, (match) => {
    if (/\d/.test(match)) {
      return match.split('').join('. ');
    }
    return match;
  });

  return cleaned.trim();
}

async function speakTelnyxNative(session: CallSession, text: string): Promise<void> {
  writeDebugLog(`[speakTelnyxNative] Sending native Telnyx TTS speak command for: "${text}"`);
  try {
    const res = await fetch(`https://api.telnyx.com/v2/calls/${session.callControlId}/actions/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        payload: text,
        voice: 'female',
        language: 'fr-FR',
        payload_type: 'text',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      writeDebugLog(`[speakTelnyxNative] Telnyx native speak failed: ${res.status} ${errText}`);
    } else {
      writeDebugLog(`[speakTelnyxNative] Telnyx native speak command sent successfully`);
    }
  } catch (err: any) {
    writeDebugLog(`[speakTelnyxNative] Error in Telnyx native speak`, err);
  }
}

/**
 * Découpe le texte en phrases pour un streaming progressif.
 * Envoie chaque phrase séparément à Cartesia avec un délai inter-phrase
 * pour un rendu plus naturel.
 * Consomme le stream HTTP de Cartesia au fil de l'eau.
 */
async function speakTtsStreamed(
  session: CallSession,
  text: string,
): Promise<void> {
  const cleanedText = cleanTextForTts(text);
  if (!cleanedText) return;
  if (!isSessionActiveForTts(session)) {
    writeDebugLog(`[speakTtsStreamed] Session inactive, state=${session.state}, ended=${session.ended}, skipping synthesis`);
    return;
  }

  writeDebugLog(`[speakTtsStreamed] Starting synthesis for text: "${cleanedText}" (original: "${text}")`);
  
  const isAlaw = session.codec === 'PCMA';
  const textWithPauses = addNaturalPauses(cleanedText);
  const sentences = textWithPauses
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0);

  writeDebugLog(`[speakTtsStreamed] Split into ${sentences.length} sentences`);

  const apiKey = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID;
  if (!apiKey || !voiceId) {
    await speakTelnyxNative(session, "Désolé, je rencontre une petite difficulté technique. Pouvez-vous répéter ?");
    return;
  }

  // Clé de cache distincte par codec Telnyx (PCMA vs PCMU) — un buffer 24k pcm
  // n'est PAS réutilisable en 8k alaw. Inclure le format garantit l'invalidation
  // des anciens caches après migration 24k→8k.
  const cacheVoiceId = `${voiceId}|sonic-3.5|${isAlaw ? 'alaw8k' : 'mulaw8k'}`;

  // ─── Traitement séquentiel avec pause inter-phrase ──────────────────
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (!isSessionActiveForTts(session)) {
      writeDebugLog(`[speakTtsStreamed] Session inactive before sentence ${i}, stopping`);
      break;
    }

    // Pause inter-phrase (sauf pour la première)
    if (i > 0) {
      writeDebugLog(`[speakTtsStreamed] Inter-sentence pause of 150ms...`);
      await new Promise(r => setTimeout(r, 150));
      if (!isSessionActiveForTts(session)) {
        writeDebugLog(`[speakTtsStreamed] Session inactive after pause, breaking loop`);
        break;
      }
    }

    // 1. Tenter le cache
    let cachedBuffer: Buffer | null = null;
    try {
      cachedBuffer = await getTtsCached(trimmed, cacheVoiceId);
    } catch (err: any) {
      writeDebugLog(`[speakTtsStreamed] TTS cache read failed`, err);
    }

    if (cachedBuffer) {
      writeDebugLog(`[speakTtsStreamed] Cache HIT for sentence: "${trimmed}"`);
      if (session.latencyTrace && !session.latencyTrace.ttsFirstByteMs) {
        session.latencyTrace.ttsFirstByteMs = Date.now() - session.latencyTrace.startTime;
      }

      // Cache contient déjà du G.711 8kHz (1 byte = 1 sample, 160 bytes = 20ms).
      const chunkSize = 160;
      let chunksSent = 0;
      for (let offset = 0; offset < cachedBuffer.length; offset += chunkSize) {
        if (!isSessionActiveForTts(session)) {
          writeDebugLog(`[speakTtsStreamed] Session inactive during send, stopping`);
          break;
        }
        const chunk = cachedBuffer.slice(offset, offset + chunkSize);
        session.telnyxWs.send(JSON.stringify({
          event: 'media',
          media: { payload: chunk.toString('base64') },
        }));
        chunksSent++;

        // Measure E2E latency on first chunk sent
        if (session.latencyTrace && !session.latencyTrace.totalE2eMs) {
          session.latencyTrace.totalE2eMs = Date.now() - session.latencyTrace.startTime;
          persistLatencyTrace(session);
        }
        
        await new Promise(r => setTimeout(r, 20));
      }
      writeDebugLog(`[speakTtsStreamed] Sent ${chunksSent} cached audio chunks to Telnyx for sentence ${i}`);
      continue;
    }

    // 2. Cache MISS ➔ Requête de streaming à Cartesia
    writeDebugLog(`[speakTtsStreamed] Cache MISS. Streaming from Cartesia for sentence: "${trimmed}"`);
    try {
      // Demander directement à Cartesia le format compatible Telnyx Media Stream
      // (G.711 alaw/mulaw 8kHz) → supprime le downsampling applicatif 24k→8k
      // et économise ~30% CPU sur le VPS.
      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2026-03-01',
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: 'sonic-3.5',
          transcript: trimmed,
          voice: { mode: 'id', id: voiceId },
          output_format: {
            container: 'raw',
            encoding: isAlaw ? 'pcm_alaw' : 'pcm_mulaw',
            sample_rate: 8000,
          },
        }),
      });

      if (!response.ok) {
        writeDebugLog(`[speakTtsStreamed] Cartesia stream failed: ${response.status}`);
        logger.error({ callId: session.callControlId, status: response.status }, '[speakTtsStreamed] Cartesia stream failed');
        if (process.env.SENTRY_DSN) {
          const err = new Error(`Cartesia stream failed with status ${response.status}`);
          Sentry.captureException(err, {
            tags: { service: 'handler', action: 'speakTtsStreamed', type: 'http-status' },
            extra: { callId: session.callControlId, status: response.status, sentence: trimmed },
          });
        }
        await speakTelnyxNative(session, "Désolé, je rencontre une petite difficulté technique. Pouvez-vous répéter ?");
        continue;
      }

      if (!response.body) {
        writeDebugLog(`[speakTtsStreamed] Cartesia stream body is null`);
        continue;
      }

      const reader = response.body.getReader();
      const playbackQueue: Buffer[] = [];
      let streamFinished = false;
      let firstByteReceived = false;

      // Background playback loop (Consumer) — envoie des chunks de 160 octets
      // (20ms d'audio 8kHz 8-bit) sur le WebSocket Telnyx.
      const playPromise = (async () => {
        let chunksSent = 0;
        while (true) {
          if (!isSessionActiveForTts(session)) {
            writeDebugLog(`[speakTtsStreamed] Session inactive during stream playback, stopping`);
            break;
          }

          if (playbackQueue.length === 0) {
            if (streamFinished) {
              break; // Tout est lu
            }
            await new Promise(r => setTimeout(r, 10)); // Sous-alimentation temporaire, attendre
            continue;
          }

          const chunk = playbackQueue.shift()!;
          session.telnyxWs.send(JSON.stringify({
            event: 'media',
            media: { payload: chunk.toString('base64') },
          }));
          chunksSent++;

          // Latence de bout en bout (E2E) enregistrée lors du tout premier chunk envoyé
          if (session.latencyTrace && !session.latencyTrace.totalE2eMs) {
            session.latencyTrace.totalE2eMs = Date.now() - session.latencyTrace.startTime;
            persistLatencyTrace(session);
          }

          await new Promise(r => setTimeout(r, 20));
        }
        writeDebugLog(`[speakTtsStreamed] Paced player sent ${chunksSent} chunks for sentence ${i}`);
      })();

      // Streaming bytes reader (Producer) — audio G.711 8kHz, 1 byte = 1 sample.
      // 160 bytes = 20ms d'audio.
      let remainingBytes = Buffer.alloc(0);
      const accumulatedChunks: Buffer[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamFinished = true;
          break;
        }

        if (!firstByteReceived) {
          firstByteReceived = true;
          writeDebugLog(`[speakTtsStreamed] First Cartesia byte received for sentence ${i}`);
          if (session.latencyTrace && !session.latencyTrace.ttsFirstByteMs) {
            session.latencyTrace.ttsFirstByteMs = Date.now() - session.latencyTrace.startTime;
          }
        }

        const rawChunk = Buffer.from(value);
        accumulatedChunks.push(rawChunk);

        const fullBytes = Buffer.concat([remainingBytes, rawChunk]);

        // Découpe en chunks de 160 bytes (20ms @ 8kHz 8-bit)
        let offset = 0;
        while (offset + 160 <= fullBytes.length) {
          playbackQueue.push(fullBytes.slice(offset, offset + 160));
          offset += 160;
        }
        remainingBytes = fullBytes.slice(offset);
      }

      // Flush final — pad avec des zeros si on a un reste < 160 bytes
      if (remainingBytes.length > 0) {
        if (remainingBytes.length < 160) {
          const padded = Buffer.concat([remainingBytes, Buffer.alloc(160 - remainingBytes.length)]);
          playbackQueue.push(padded);
        } else {
          playbackQueue.push(remainingBytes);
        }
      }

      streamFinished = true;
      await playPromise; // Attendre la fin de la lecture progressive

      // 3. Mettre en cache Redis le buffer G.711 8kHz complet
      const codec8kFull = Buffer.concat(accumulatedChunks);
      try {
        await setTtsCached(trimmed, cacheVoiceId, codec8kFull);
      } catch (err: any) {
        writeDebugLog(`[speakTtsStreamed] TTS cache write failed`, err);
      }

    } catch (err: any) {
      writeDebugLog(`[speakTtsStreamed] Cartesia stream process error for sentence: "${trimmed}"`, err);
      logger.error({ err, callId: session.callControlId }, `[speakTtsStreamed] Cartesia stream process error: ${err.message}`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'handler', action: 'speakTtsStreamed', type: 'exception' },
          extra: { callId: session.callControlId, sentence: trimmed },
        });
      }
      await speakTelnyxNative(session, "Désolé, je rencontre une petite difficulté technique. Pouvez-vous répéter ?");
    }
  }
}
