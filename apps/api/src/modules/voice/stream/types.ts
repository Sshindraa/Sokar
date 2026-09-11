import type { WebSocket } from 'ws';
import type { VoiceLanguageCode } from './voice-language';

/** États possibles de la conversation */
export type CallState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'CLOSING';

/** Acte de parole détecté avant l'orchestration LLM. */
export type VoiceSpeechAct = 'liveness' | 'backchannel' | 'closing' | 'correction' | 'content';

export type NameCollectionState = 'idle' | 'collecting' | 'clarifying' | 'confirming' | 'confirmed';

/** Réponse métier attendue après la dernière question de l'agent. */
export type PendingQuestion =
  | 'date'
  | 'time'
  | 'timeChoice'
  | 'partySize'
  | 'customerName'
  | 'customerPhone'
  | 'confirmation'
  | null;

export type SpellingTokenKind = 'letter' | 'separator' | 'ambiguous';

/** Token conservé pendant une épellation, y compris quand le STT n'est pas sûr. */
export interface SpellingToken {
  /** Position logique dans le nom (les séparateurs ne consomment pas d'ordinal). */
  position: number;
  raw: string;
  value: string | null;
  kind: SpellingTokenKind;
}

/** État dédié à la collecte du nom, indépendant de la dernière question LLM. */
export interface NameCollection {
  state: NameCollectionState;
  /** Candidat avec `?` aux positions ambiguës, séparateurs explicites conservés. */
  partialCandidate: string;
  tokens: SpellingToken[];
  ambiguousPositions: number[];
  /** Nombre de réponses infructueuses aux demandes de clarification. */
  clarificationCount: number;
  /** Une correction a été détectée mais sa position/lettre reste à préciser. */
  awaitingCorrection: boolean;
  /** Valeur effectivement présentée à l'appelant pour confirmation. */
  presentedCandidate: string | null;
  confirmedName: string | null;
  /** Une prise de message humaine a terminé la collecte sans confirmer le nom. */
  fallbackRecorded: boolean;
}

/** Mot reconnu et ses métadonnées STT. */
export interface SttWord {
  word: string;
  punctuatedWord?: string;
  confidence?: number;
  start?: number;
  end?: number;
}

/** Paramètres de détection de fin de tour appliqués à la session STT. */
export interface SttTurnConfig {
  vadSilenceThresholdSecs: number;
  minSpeechDurationMs: number;
  minSilenceDurationMs: number;
}

export interface SttTurnConfigState {
  base: SttTurnConfig;
  desired: SttTurnConfig;
  applied: SttTurnConfig | null;
  spellingActive: boolean;
  /** Profil réellement actif avant l'entrée dans le mode épellation. */
  previous?: SttTurnConfig | null;
}

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
  /** Contexte explicite utilisé pour interpréter les réponses courtes. */
  pendingQuestion: PendingQuestion;
  lastAssistantQuestion: string | null;
  /** Clé du dernier récapitulatif de réservation qui attend un accord explicite. */
  pendingReservationConfirmationKey: string | null;
  /** Clé du brouillon accepté explicitement, consommée à la création. */
  confirmedReservationKey: string | null;
  /** Nom épelé détecté, en attente de confirmation explicite par l'appelant. */
  spellingCandidate: string | null;
  nameCollection: NameCollection;
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
  /** Numéro monotone des événements structurés de ce tour. */
  eventSequence?: number;
}

/** Événements normalisés produits par le fournisseur STT. */
export type SttEvent =
  | { type: 'UtteranceStart' }
  | {
      type: 'UtteranceEnd';
      transcript: string;
      words?: SttWord[];
      /** Code ISO détecté par Scribe sur le segment final, si disponible. */
      languageCode?: string;
    }
  | { type: 'SpeechResumed' }
  | {
      type: 'InterimHighConfidence';
      transcript: string;
      words?: SttWord[];
    }
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
  mark?: { name: string };
  stream_id?: string;
}

/** Message de chat au format OpenAI-compatible (Cerebras, Groq, OpenRouter) */
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
  /** Numéro E.164 du gérant pour le transfert humain, si configuré. */
  managerPhone?: string | null;
  timezone: string;
  /** Montant minimum d'une carte cadeau — stocké à la création de session */
  giftCardMinimumAmount: number;
  systemPrompt: string;
  state: CallState;
  ended: boolean;
  /** Vrai après l'acceptation Telnyx d'un transfert vers le gérant. */
  handoffInProgress?: boolean;
  /** Conclusion du dernier transfert tenté, consommée par l'orchestrateur LLM. */
  handoffConclusion?: string;
  ending?: {
    markName: string;
    nativePlayback: boolean;
    playbackCompleted: boolean;
    mediaCompleted?: boolean;
    nativeCompleted?: boolean;
    complete?: () => void;
    timer?: ReturnType<typeof setTimeout>;
  };
  turnCount: number;
  isVip: boolean;
  codec: 'PCMA' | 'PCMU';
  history: ChatMessage[];

  // WebSockets
  telnyxWs: WebSocket;
  sttWs: WebSocket | null;
  /** Promise résolue quand le fournisseur STT est connecté (pre-warm) */
  sttReady: Promise<void> | null;
  /** Callback mutable pour les événements STT (remplacé par le handler WS) */
  onSttEvent: ((event: SttEvent) => void) | null;
  /** Modèle STT actif. */
  sttModel?: string;
  /** Dernière langue détectée par Scribe sur un segment final. */
  sttLanguageCode?: string;
  /** Langue de dialogue active pour le LLM et le TTS. */
  voiceLanguageCode?: VoiceLanguageCode;
  /**
   * Candidat de changement de langue en attente d'un second segment fiable.
   * Scribe peut attribuer une langue différente à un fragment bruité ; on
   * ne change donc pas la langue de dialogue sur une seule détection fragile.
   */
  voiceLanguageCandidate?: {
    code: VoiceLanguageCode;
    count: number;
  } | null;
  /** Indique si le premier paquet audio de la socket Scribe a déjà été envoyé. */
  sttFirstAudioChunkSent?: boolean;
  /** Profil EOT courant ; conservé même quand le WebSocket est reconnecté. */
  sttTurnConfig?: SttTurnConfigState;
  /** Commit simple en attente de son éventuel événement horodaté associé. */
  sttPendingCommit?: {
    transcript: string;
    words?: SttWord[];
    languageCode?: string;
    timer: ReturnType<typeof setTimeout>;
  } | null;
  /** Timer de grâce pour une fin de tour reçue pendant une épellation. */
  sttEndOfTurnTimer?: ReturnType<typeof setTimeout> | null;
  /** Fin de tour mise en attente pendant cette courte grâce. */
  pendingSttEndOfTurn?: {
    transcript: string;
    words?: SttWord[];
    languageCode?: string;
  } | null;

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
  /** Tour utilisateur courant, créé à la finalisation STT. */
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
  /** Timer de fallback conservé pour une fin de tour STT tardive */
  speechFinalTimer: ReturnType<typeof setTimeout> | null;

  // Timeouts
  lastActivityAt: number;
  createdAt: number;

  // Latence
  latencyTrace?: {
    startTime: number;
    /** Horodatages/durées ajoutés pour la chronologie de diagnostic. */
    speechStartedAt?: number;
    sttFinalAt?: number;
    sttFinalMs?: number;
    llmFirstTokenMs?: number;
    llmFirstPhraseMs?: number;
    llmCompletedMs?: number;
    ttsSynthesisStartedAt?: number;
    ttsFirstByteMs?: number;
    audioSentAt?: number;
    ttsCompletedMs?: number;
    interruptedAt?: number;
    totalE2eMs?: number;
  };
  personality: {
    fillerStyle: 'CASUAL' | 'FORMAL' | 'WARM';
    systemPromptExtra?: string | null;
    speakingRate?: number | null;
    voiceIdCa?: string | null;
    pronunciationDictId?: string | null;
    volume?: number | null;
    emotion?: string | null;
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
