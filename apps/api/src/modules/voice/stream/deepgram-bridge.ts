import { WebSocket } from 'ws';
import type { CallSession, FluxEvent } from './types';
import { CallSessionManager } from './manager';

const DEEPGRAM_API_URL = 'wss://api.deepgram.com/v2/listen';
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
    const params = new URLSearchParams({
      model: 'flux-general-multi',
      language: 'fr',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      utterance_end_ms: '900',
    });

    const url = `${DEEPGRAM_API_URL}?${params}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    session.deepgramWs = ws;

    ws.on('open', () => {
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
        handleDeepgramMessage(session, msg);
      } catch (err) {
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

  if (session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN) {
    session.deepgramWs.send(audioBuffer);
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

      // Barge-in : si on était en train de parler, le caller a coupé
      if (session.state === 'SPEAKING') {
        mgr.handleBargeIn(session);
      }

      // Annuler toute spéculation en cours (le caller continue)
      session.speculativeLlm = null;
      session.speculativeResult = null;
      session.speculativeTranscript = '';

      session.onDeepgramEvent?.({ type: 'UtteranceStart' });
      break;
    }

    case 'SpeechResumed':
      // Le caller continue après une pause → annuler la spéculation
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
      const isFinal = msg.speech_final === true;
      const confidence = msg.channel?.alternatives?.[0]?.confidence ?? 0;

      if (isFinal && transcript.trim()) {
        session.onDeepgramEvent?.({ type: 'FinalTranscript', transcript });
      }

      // Spéculation LLM : interim stable, confiance > 0.95, au moins 3 mots
      const wordCount = transcript.trim().split(/\s+/).length;
      const lastTranscript = session.speculativeTranscript;

      if (
        !isFinal &&
        !session.speculativeLlm &&
        confidence >= 0.95 &&
        wordCount >= 3 &&
        wordCount <= 20 &&
        transcript !== lastTranscript // éviter les doublons
      ) {
        session.speculativeTranscript = transcript;
        // Le handler déclenchera le LLM spéculatif via l'event
        session.onDeepgramEvent?.({ type: 'InterimHighConfidence', transcript } as any);
      }
      break;
    }

    default:
      // Ignorer les autres types (interim, etc.)
      break;
  }
}
