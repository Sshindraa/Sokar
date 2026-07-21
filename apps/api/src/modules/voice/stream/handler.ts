/**
 * Handler WebSocket Telnyx Media Stream — orchestrator.
 *
 * Reçoit l'audio en temps réel de Telnyx, le forwarde à Deepgram Flux,
 * reçoit les transcripts, les envoie au LLM, génère du TTS Cartesia,
 * et renvoie l'audio à Telnyx via le stream bidirectionnel.
 *
 * Barge-in : quand le caller parle pendant le TTS, Flux détecte
 * UtteranceStart → on clear le buffer Telnyx → on réécoute.
 *
 * Architecture :
 *   - debug-log.ts       → writeDebugLog (utilitaire partagé)
 *   - session-persistence.ts → persistFluxCall, persistLatencyTrace (DB)
 *   - tts-handler.ts     → speakTtsStreamed, cleanTextForTts, etc. (Cartesia)
 *   - llm-handler.ts     → handleFluxEvent, processTranscriptStreaming, etc. (Deepgram Flux)
 *   - handler.ts (this)  → registerMediaStreamRoutes, handleTelnyxMessage (orchestrator)
 *
 * NOTE: audio-buffer.ts n'a pas été créé car la gestion du buffer audio
 * (session.audioBuffer) se fait dans deepgram-bridge.ts, pas dans ce
 * handler. Il n'y a pas de logique de buffer à extraire ici.
 */

import type { FastifyInstance } from 'fastify';
import '@fastify/websocket';
import { WebSocket } from 'ws';
import type { TelnyxStreamMessage, FluxEvent, CallSession } from './types';
import { CallSessionManager } from './manager';
import { sendAudioToDeepgram, closeDeepgram, connectDeepgramFlux } from './deepgram-bridge';
import { logger } from '../../../shared/logger/pino';
import { captureException } from '../../../shared/sentry/client';
import { writeDebugLog } from './debug-log';
import { persistFluxCall, persistLatencyTrace } from './session-persistence';
import { speakTtsStreamed } from './tts-handler';
import { handleFluxEvent, extractRestaurantName } from './llm-handler';

/**
 * Enregistre la route WebSocket pour le media stream Telnyx.
 * Utilise @fastify/websocket pour la gestion des connexions WS.
 */
export function registerMediaStreamRoutes(app: FastifyInstance): void {
  app.get('/voice/stream/:callId', { websocket: true }, (socket, req) => {
    const callId = (req.params as { callId: string }).callId;
    const mgr = CallSessionManager.getInstance();

    // Per-call child logger. Every log line emitted from this WS handler
    // (and from any function it calls) will carry `call_id`, which makes
    // it possible to grep a single call's full lifecycle in production:
    //   pm2 logs | jq 'select(.call_id == "v3:abc123")'
    // The base logger is the shared one (so secrets redaction and the
    // service/env bindings still apply).
    const log = logger.child({ call_id: callId });
    log.info('[stream] New Telnyx WS connection for call');

    // Récupérer la session créée par call.initiated
    let session: CallSession | undefined;

    socket.on('message', (raw: Buffer) => {
      try {
        const msg: TelnyxStreamMessage = JSON.parse(raw.toString());
        session = handleTelnyxMessage(msg, callId, socket, mgr) ?? session;
      } catch (err) {
        log.error({ err }, '[stream] Parse error');
      }
    });

    socket.on('close', () => {
      log.info('[stream] Telnyx WS closed');
      if (session) {
        session.ended = true;
        session.state = 'IDLE';
        session.isSpeaking = false;
        // Persister les traces avant cleanup (fire-and-forget, mais avec catch
        // pour éviter unhandledRejection silencieux dans un WS handler).
        persistLatencyTrace(session).catch((err) =>
          log.error({ err }, '[stream] persistLatencyTrace failed'),
        );
        persistFluxCall(session).catch((err) =>
          log.error({ err }, '[stream] persistFluxCall failed'),
        );
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
    });

    socket.on('error', (err: Error) => {
      log.error({ err }, `[stream] Error for call: ${err.message}`);
      captureException(err, {
        tags: { service: 'handler', event: 'websocket-error' },
        extra: { callId },
      });
      if (session) {
        session.ended = true;
        session.state = 'IDLE';
        session.isSpeaking = false;
        persistLatencyTrace(session).catch((err) =>
          log.error({ err }, '[stream] persistLatencyTrace failed (error path)'),
        );
        persistFluxCall(session).catch((err) =>
          log.error({ err }, '[stream] persistFluxCall failed (error path)'),
        );
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
      logger.info(
        { callId: start.call_control_id, from: start.from, encoding: start.media_format.encoding },
        '[stream] Start call',
      );

      const session = mgr.get(start.call_control_id);
      if (!session) {
        writeDebugLog(`[stream] No session found for ${start.call_control_id}`);
        logger.warn({ callId: start.call_control_id }, '[stream] No session found for start event');
        return;
      }

      // Assigner le WebSocket Telnyx à la session (manquant — cause du silence)
      session.telnyxWs = socket;

      // Connecter et démarrer Deepgram Flux STT pour la session
      session.onDeepgramEvent = (event: FluxEvent) => handleFluxEvent(event, session, mgr);
      connectDeepgramFlux(session)
        .then(() => {
          writeDebugLog(`[stream] Deepgram ready for ${start.call_control_id}`);
          logger.info({ callId: start.call_control_id }, '[stream] Deepgram ready');
        })
        .catch((err) => {
          writeDebugLog(`[stream] Deepgram failed to connect`, err);
          logger.error(
            { err, callId: start.call_control_id },
            `[stream] Deepgram failed to connect: ${(err as Error).message}`,
          );
          captureException(err as Error, {
            tags: { service: 'handler', action: 'deepgram-ready' },
            extra: { callId: start.call_control_id },
          });
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
          logger.error(
            { err, callId: session.callControlId },
            '[stream] Initial greeting TTS failed',
          );
          captureException(err, {
            tags: { service: 'handler', action: 'greeting-tts' },
            extra: { callId: session.callControlId },
          });
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
        persistLatencyTrace(session).catch((err) =>
          logger.error({ err, callId }, '[stream] persistLatencyTrace failed'),
        );
        persistFluxCall(session).catch((err) =>
          logger.error({ err, callId }, '[stream] persistFluxCall failed'),
        );
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
      return;
    }

    case 'dtmf':
      return;

    case 'error':
      logger.error({ callId, msg }, '[stream] Telnyx error event');
      const errorDetail = new Error(`Telnyx error event for call ${callId}`);
      captureException(errorDetail, {
        tags: { service: 'handler', event: 'telnyx-error' },
        extra: { callId, payload: msg },
      });
      return;

    default:
      return;
  }
}
