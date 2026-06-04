import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { CallSession, FluxEvent } from './types';
import { CallSessionManager } from './manager';

function writeDebugLog(msg: string, err?: any) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}${err ? ' | ERROR: ' + err.message + '\n' + err.stack : ''}\n`;
  try {
    const logPath = process.env.DEBUG_LOG_PATH || path.join(process.cwd(), 'scratch', 'call_debug.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logMsg);
  } catch (e) {
    console.error('Failed to write debug log:', e);
  }
}

const DEEPGRAM_API_URL = 'wss://api.deepgram.com/v1/listen';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? '';

/**
 * Pont audio entre Telnyx et Deepgram Flux.
 *
 * - Reçoit l'audio PCMU/L16 de Telnyx
 * - Le forwarde à Deepgram avec model=flux-general-multi
 * - Retourne les événements de transcription (utterance, turn, etc.)
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

  console.log(`[deepgram] Initiating connection for ${session.callControlId}...`);
  const promise = new Promise<void>((resolve, reject) => {
    const isAlaw = session.codec === 'PCMA';
    const params = new URLSearchParams({
      model: process.env.DEEPGRAM_MODEL ?? 'nova-3',
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

    // Boost critical reservation vocabulary for Nova-3
    const keyterms = [
      'réservation', 'personnes', 'soir', 'heures', 'midi', 'couverts',
      'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'
    ];
    for (const term of keyterms) {
      params.append('keyterm', term);
    }

    const url = `${DEEPGRAM_API_URL}?${params}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    session.deepgramWs = ws;

    ws.on('open', () => {
      writeDebugLog(`[deepgram] Connected successfully for call ${session.callControlId}. Sending ${session.audioBuffer.length} buffered chunks`);
      console.log(`[deepgram] Connected for call ${session.callControlId}`);

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
        writeDebugLog(`[deepgram] Message received: type=${msg.type} is_final=${msg.is_final} speech_final=${msg.speech_final} channel_trans="${msg.channel?.alternatives?.[0]?.transcript}"`);
        handleDeepgramMessage(session, msg);
      } catch (err) {
        writeDebugLog(`[deepgram] Parse error in message`, err);
        console.error('[deepgram] Parse error:', err);
      }
    });

    ws.on('error', (err: Error) => {
      console.error(`[deepgram] Error for ${session.callControlId}:`, err.message);
      onEvent?.({ type: 'Error', message: err.message });
      reject(err);
    });

    ws.on('close', () => {
      console.log(`[deepgram] Disconnected for ${session.callControlId}`);
      session.deepgramWs = null;
      session.deepgramReady = null;
    });
  });

  session.deepgramReady = promise;
  return promise;
}

/**
 * Limite du buffer audio Deepgram (en chunks) avant de drop les plus vieux.
 * ~200 chunks = ~4s d'audio à 50chunks/s (20ms par chunk)
 */
const DEEPGRAM_AUDIO_BUFFER_MAX = 200;

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
    }, 200);
  }
}

// ─── Parsing des messages Deepgram Flux ──────────────────────────

interface DeepgramMessage {
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

function handleDeepgramMessage(
  session: CallSession,
  msg: DeepgramMessage,
): void {
  const mgr = CallSessionManager.getInstance();

  switch (msg.type) {
    case 'UtteranceStart': {
      console.log(`[deepgram] Utterance start — ${session.callControlId}`);

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
        console.log(`[deepgram] Utterance end: \"${transcript.slice(0, 60)}...\"`);
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
        console.log(`[barge-in] User spoke: "${transcript.trim()}" while assistant was speaking. Interrupting.`);
        if (session.abortController) {
          session.abortController.abort();
          session.abortController = null;
        }
        mgr.handleBargeIn(session);
      }

      if (isFinal) {
        if (transcript.trim()) {
          session.turnTranscript += (session.turnTranscript ? ' ' : '') + transcript.trim();
          console.log(`[deepgram] Segment finalized: "${transcript.slice(0, 60)}..." (speech_final=${isSpeechFinal})`);
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
            console.log(`[deepgram] Speech final (turn completed): "${fullTurnTranscript.slice(0, 60)}..."`);
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

          writeDebugLog(`[deepgram] Starting ${timeoutMs}ms smart timer (punctuation=${endsWithPunctuation})`);
          session.speechFinalTimer = setTimeout(() => {
            if (session.turnTranscript.trim()) {
              const fallbackTranscript = session.turnTranscript;
              session.turnTranscript = '';
              session.speechFinalTimer = null;
              writeDebugLog(`[deepgram] Smart timer fired! (${timeoutMs}ms) UtteranceEnd: "${fallbackTranscript.slice(0, 80)}"`);
              console.log(`[deepgram] Speech final (smart ${timeoutMs}ms): "${fallbackTranscript.slice(0, 60)}..."`);
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
        console.log(`[deepgram] Speech final (forced fallback): "${fullTurnTranscript.slice(0, 60)}..."`);
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
        session.onDeepgramEvent?.({ type: 'InterimHighConfidence', transcript } as any);
      }
      break;
    }

    default:
      // Ignorer les autres types (interim, etc.)
      break;
  }
}
