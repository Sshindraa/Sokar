import type { WebSocket } from 'ws';

/** États possibles de la conversation */
export type CallState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

/** Événements Deepgram Flux */
export type FluxEvent =
  | { type: 'UtteranceStart' }
  | { type: 'UtteranceEnd'; transcript: string }
  | { type: 'SpeechResumed' }
  | { type: 'EagerEndOfTurn'; transcript: string }
  | { type: 'FinalTranscript'; transcript: string }
  | { type: 'InterimHighConfidence'; transcript: string }
  | { type: 'Error'; message: string };

/** Message entrant de Telnyx Media Stream WebSocket */
export interface TelnyxStreamMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'dtmf' | 'error' | 'mark';
  sequence_number?: string;
  start?: {
    call_control_id: string;
    call_session_id: string;
    from: string;
    to: string;
    media_format: { encoding: string; sample_rate: number; channels: number };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // base64
  };
  stop?: {
    call_control_id: string;
  };
  stream_id?: string;
}

/** Session d'un appel avec flux audio */
export interface CallSession {
  callControlId: string;
  callSessionId: string;
  from: string;
  to: string;
  restaurantId: string;
  systemPrompt: string;
  state: CallState;
  turnCount: number;
  isVip: boolean;

  // WebSockets
  telnyxWs: WebSocket;
  deepgramWs: WebSocket | null;
  /** Promise résolue quand Deepgram est connecté (pre-warm) */
  deepgramReady: Promise<void> | null;
  /** Callback mutable pour les événements Deepgram (remplacé par le handler WS) */
  onDeepgramEvent: ((event: FluxEvent) => void) | null;

  // Gestion audio
  audioBuffer: Buffer[];
  isSpeaking: boolean;

  // Barge-in debounce
  /** Nombre de chunks inbound consécutifs reçus pendant SPEAKING */
  bargeInChunks: number;

  // LLM spéculatif
  /** Promise LLM en cours (spéculation sur interim result) */
  speculativeLlm: Promise<string> | null;
  /** Transcript utilisé pour la spéculation (pour vérifier si toujours valide) */
  speculativeTranscript: string;
  /** Résultat LLM spéculatif mis en cache (résolu) */
  speculativeResult: string | null;

  // Timeouts
  lastActivityAt: number;
  createdAt: number;
}

/** Config retournée à Telnyx pour lancer le media stream */
export interface MediaStreamConfig {
  stream_url: string;
  stream_track: 'inbound_track';
  stream_bidirectional_mode: 'rtp';
  stream_bidirectional_codec: 'L16';
}
