import type { WebSocket } from 'ws';

/** États possibles de la conversation */
export type CallState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

/** Acte de parole détecté avant l'orchestration LLM. */
export type VoiceSpeechAct = 'liveness' | 'backchannel' | 'closing' | 'correction' | 'content';

/**
 * Mémoire métier minimale d'un appel. Le LLM conserve la compréhension fine ;
 * cet état empêche les tours courts de réinitialiser artificiellement le dialogue.
 */
export interface ConversationState {
  intent: 'reservation' | 'availability' | 'cancel' | 'delay' | 'message' | 'gift_card' | null;
  slots: {
    date?: string;
    time?: string;
    partySize?: number;
    customerName?: string;
    customerPhone?: string;
  };
  toolInFlight: 'checkAvailability' | null;
  lastAvailabilityCheck: string | null;
  /** Dernier résultat réellement renvoyé par le moteur de disponibilité. */
  lastAvailabilityResult: {
    key: string;
    date: string;
    time: string;
    partySize: number;
    slots: string[];
  } | null;
  pendingQuestion: 'date' | 'time' | 'partySize' | 'customerName' | 'customerPhone' | null;
  lastAssistantQuestion: string | null;
  misunderstandingCount: number;
  closing: boolean;
}

/** Contrat minimal du contexte Cartesia actif, sans coupler le manager au transport. */
export interface ActiveTtsContext {
  cancel(): void;
}

/** Identité minimisée du tour courant pour les logs d'observabilité. */
export interface VoiceTurnTelemetry {
  id: string;
  startedAt: number;
  transcriptLength: number;
  transcriptFingerprint: string;
}

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

/** Message de chat au format OpenRouter/OpenAI */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Session d'un appel avec flux audio */
export interface CallSession {
  callControlId: string;
  callSessionId: string;
  /** call_leg_id Telnyx — utilisé comme callSid en DB */
  callLegId: string;
  from: string;
  to: string;
  restaurantId: string;
  restaurantName: string;
  timezone: string;
  /** Montant minimum d'une carte cadeau — stocké à la création de session */
  giftCardMinimumAmount: number;
  systemPrompt: string;
  state: CallState;
  ended: boolean;
  turnCount: number;
  isVip: boolean;
  codec: 'PCMA' | 'PCMU';
  history: ChatMessage[];

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
  /**
   * File de lecture TTS de l'appel. Les fragments livrés par le LLM arrivent
   * parfois avant que Cartesia ait fini le précédent ; les sérialiser évite
   * deux flux audio Telnyx superposés.
   */
  ttsPlayback: Promise<void>;
  /** Invalide définitivement les fragments TTS interrompus par un barge-in. */
  ttsGeneration: number;
  /** Invalide une réponse en préparation dès que l'appelant reprend la parole. */
  responseGeneration: number;
  /** Contexte Cartesia optionnel pour la réponse LLM streamée en cours. */
  ttsContext: ActiveTtsContext | null;
  /** Tour utilisateur courant, créé à la finalisation Deepgram. */
  currentTurn: VoiceTurnTelemetry | null;

  // Barge-in debounce
  /** Nombre de chunks inbound consécutifs reçus pendant SPEAKING */
  bargeInChunks: number;

  // Annulation LLM
  /** AbortController pour annuler la requête LLM en cours */
  abortController: AbortController | null;

  // LLM spéculatif
  /** Promise LLM en cours (spéculation sur interim result) */
  speculativeLlm: Promise<string> | null;
  /** Transcript utilisé pour la spéculation (pour vérifier si toujours valide) */
  speculativeTranscript: string;
  /** Résultat LLM spéculatif mis en cache (résolu). */
  speculativeResult: string | null;

  // Transcript cumulé (persistance)
  /** Transcript final cumulé de tout l'appel (concaténation des UtteranceEnd) */
  transcript: string;
  /** Buffer pour accumuler les segments d'un tour de parole */
  turnTranscript: string;
  /** Timer de fallback : force UtteranceEnd si speech_final tarde trop */
  speechFinalTimer: ReturnType<typeof setTimeout> | null;

  // Timeouts
  lastActivityAt: number;
  createdAt: number;

  // Latence
  latencyTrace?: {
    startTime: number;
    sttFinalMs?: number;
    llmFirstTokenMs?: number;
    ttsFirstByteMs?: number;
    totalE2eMs?: number;
  };
  personality: {
    fillerStyle: 'CASUAL' | 'FORMAL' | 'WARM';
    systemPromptExtra?: string | null;
  } | null;
  conversation: ConversationState;
}

/** Config retournée à Telnyx pour lancer le media stream */
export interface MediaStreamConfig {
  stream_url: string;
  stream_track: 'inbound_track';
  stream_bidirectional_mode: 'rtp';
  stream_bidirectional_codec: 'PCMA' | 'PCMU';
}
