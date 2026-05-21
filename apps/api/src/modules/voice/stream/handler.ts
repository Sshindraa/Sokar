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
import { WebSocket } from 'ws';
import type { TelnyxStreamMessage, FluxEvent, CallSession } from './types';
import { CallSessionManager } from './manager';
import { connectDeepgramFlux, sendAudioToDeepgram, closeDeepgram } from './deepgram-bridge';
import { playFiller } from './fillers-cache';

/**
 * Enregistre la route WebSocket pour le media stream Telnyx.
 * Utilise @fastify/websocket pour la gestion des connexions WS.
 */
export function registerMediaStreamRoutes(app: FastifyInstance): void {
  app.get('/voice/stream/:callId', { websocket: true }, (socket, req) => {
    const callId = (req.params as any).callId as string;
    const mgr = CallSessionManager.getInstance();

    console.log(`[stream] New Telnyx WS connection for call ${callId}`);

    // Récupérer la session créée par call.initiated
    let session: CallSession | undefined;

    socket.on('message', (raw: Buffer) => {
      try {
        const msg: TelnyxStreamMessage = JSON.parse(raw.toString());
        session = handleTelnyxMessage(msg, callId, socket, mgr) ?? session;
      } catch (err) {
        console.error('[stream] Parse error:', err);
      }
    });

    socket.on('close', () => {
      console.log(`[stream] Telnyx WS closed for ${callId}`);
      if (session) {
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
    });

    socket.on('error', (err: Error) => {
      console.error(`[stream] Error for ${callId}:`, err.message);
      if (session) {
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
      console.log(`[stream] Telnyx connected for ${callId}`);
      return;

    case 'start': {
      const start = msg.start!;
      console.log(`[stream] Start — call ${start.call_control_id}, from ${start.from}, ` +
        `encoding ${start.media_format.encoding}`);

      const session = mgr.get(start.call_control_id);
      if (!session) {
        console.warn(`[stream] No session found for ${start.call_control_id}`);
        return;
      }

      // Deepgram est déjà en cours de connexion (pre-warmé dans call.initiated)
      // On attache juste le handler d'events
      session.onDeepgramEvent = (event: FluxEvent) => handleFluxEvent(event, session, mgr);
      session.deepgramReady?.then(() => {
        console.log(`[stream] Deepgram ready for ${start.call_control_id}`);
      }).catch((err) => {
        console.error(`[stream] Deepgram was not ready: ${err.message}`);
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

      // Barge-in avec debounce (3 chunks inbound consécutifs = ~60ms de parole)
      if (session.state === 'SPEAKING' && msg.media?.track === 'inbound') {
        session.bargeInChunks++;
        if (session.bargeInChunks >= 3) {
          mgr.handleBargeIn(session);
          session.bargeInChunks = 0;
        }
      } else if (session.state !== 'SPEAKING') {
        // Reset du compteur si on n'est plus en train de parler
        session.bargeInChunks = 0;
      }

      return session;
    }

    case 'stop': {
      console.log(`[stream] Telnyx stream stop for ${callId}`);
      const session = mgr.get(callId);
      if (session) {
        closeDeepgram(session);
        mgr.delete(session.callControlId);
      }
      return;
    }

    case 'dtmf':
      return;

    case 'error':
      console.error(`[stream] Telnyx error for ${callId}:`, msg);
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
      if (session.state !== 'LISTENING' && session.state !== 'IDLE') break;

      session.state = 'PROCESSING'; // transition optimiste
      session.speculativeLlm = mgr.processUtterance(session, event.transcript)
        .then((response) => {
          session.speculativeResult = response;
          return response;
        })
        .catch((err) => {
          console.error(`[speculative] LLM failed: ${err.message}`);
          session.speculativeLlm = null;
          session.speculativeResult = null;
          return '';
        });
      break;
    }

    case 'UtteranceEnd': {
      // Vérifier si une spéculation est en cours et si le transcript correspond
      const speculativeTranscript = session.speculativeTranscript;

      if (
        session.speculativeLlm &&
        speculativeTranscript &&
        transcriptsMatch(speculativeTranscript, event.transcript)
      ) {
        // La spéculation est valide → utiliser le résultat en cache
        console.log(`[speculative] Match! Using cached LLM response`);
        session.speculativeLlm.then(async (response) => {
          if (response) {
            mgr.transition(session, 'SPEAKING');
            await speakTts(session, response);
            mgr.transition(session, 'LISTENING');
          }
        });
        session.speculativeLlm = null;
      } else if (session.state === 'LISTENING' || session.state === 'IDLE') {
        // Pas de spéculation valide → LLM normal
        processTranscript(session, event.transcript, mgr);
      }
      break;
    }

    case 'FinalTranscript': {
      break;
    }

    case 'Error': {
      console.error(`[flux] Error: ${event.message}`);
      speakTts(session, "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?");
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
 */
async function processTranscript(
  session: CallSession,
  transcript: string,
  mgr: CallSessionManager,
): Promise<void> {
  if (!transcript.trim()) return;

  try {
    // Jouer un filler immédiatement pendant que le LLM réfléchit
    playFiller(session.telnyxWs, 'CASUAL');

    // LLM
    const llmResponse = await mgr.processUtterance(session, transcript);

    // Clear le filler si encore en cours de lecture
    if (session.telnyxWs.readyState === WebSocket.OPEN) {
      session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
    }

    // TTS
    await speakTts(session, llmResponse);

    // Retour en écoute
    mgr.transition(session, 'LISTENING');
  } catch (err) {
    console.error(`[pipeline] Error:`, err);
    mgr.transition(session, 'LISTENING');
  }
}

/**
 * Synthétise une réponse vocale avec Cartesia et l'envoie à Telnyx.
 * Lit le stream SSE Cartesia → chaque chunk audio → Telnyx WS.
 */
async function speakTts(session: CallSession, text: string): Promise<void> {
  const response = await fetch('https://api.cartesia.ai/tts/sse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cartesia-Version': '2026-03-01',
      'X-API-Key': process.env.CARTESIA_API_KEY ?? '',
    },
    body: JSON.stringify({
      model_id: 'sonic-3.5',
      transcript: text,
      voice: {
        mode: 'id',
        id: process.env.CARTESIA_VOICE_ID ?? 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_mulaw',
        sample_rate: 8000,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`TTS ${response.status}: ${await response.text()}`);
  }

  session.isSpeaking = true;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'chunk' && parsed.audio) {
          if (session.telnyxWs.readyState === WebSocket.OPEN) {
            session.telnyxWs.send(JSON.stringify({
              event: 'media',
              media: { payload: parsed.audio },
            }));
          }
        }
        if (parsed.type === 'done') break;
      } catch { /* skip */ }
    }

    // Si barge-in, arrêter le TTS
    if (session.state !== 'SPEAKING') {
      reader.cancel();
      break;
    }
  }

  session.isSpeaking = false;
}
