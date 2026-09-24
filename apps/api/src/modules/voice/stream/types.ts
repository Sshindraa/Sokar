import type { WebSocket } from 'ws';
import type { VoiceLanguageCode } from './voice-language';

/** États possibles de la conversation */
export type CallState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'CLOSING';

/** Acte de parole détecté avant l'orchestration LLM. */
export type VoiceSpeechAct = 'liveness' | 'backchannel' | 'closing' | 'correction' | 'content';

/**
 * `explicit` : extracteur sur une formulation explicite ; `contextual` : nombre
 * nu lu grâce à la question en attente ; `confirmation` : validé par l'appelant ;
 * `model` : complété par un TurnPlan accepté.
 */
export type SlotProvenanceSource = 'explicit' | 'contextual' | 'confirmation' | 'model';

export type NameCollectionState = 'idle' | 'collecting' | 'clarifying' | 'confirming' | 'confirmed';

/** Moment de la journée exprimé par l'appelant. */
export type DayPeriod = 'lunch' | 'dinner';

/** Réponse métier attendue après la dernière question de l'agent. */
export type PendingQuestion =
  | 'date'
  | 'time'
  | 'timeChoice'
  | 'partySize'
  | 'partySizeConfirmation'
  | 'customerName'
  | 'customerPhone'
  | 'confirmation'
  /** Repli humain proposé après un blocage de dialogue (message ou transfert). */
  | 'humanFallback'
  | null;

/** Action proposée et encore en attente de choix explicite. */
export type HumanFallbackMode = 'choice' | 'transfer' | 'message' | null;

export type PendingInteractionKind = Exclude<PendingQuestion, null> | 'open';
export type PendingInteractionStatus = 'active' | 'suspended' | 'resolved' | 'cancelled';
export type PendingInteractionResumePolicy = 'resume_after_child' | 'discard_on_detour' | null;

/** Question/action en attente, avec un cycle de vie distinct de la transcription. */
export interface PendingInteraction {
  id: number;
  kind: PendingInteractionKind;
  prompt: string;
  status: PendingInteractionStatus;
  resumePolicy: PendingInteractionResumePolicy;
  /** Intention métier active au moment où cette question a été posée. */
  intentContext?: ConversationState['intent'];
  fallbackMode?: Exclude<HumanFallbackMode, null>;
  candidatePartySize?: number;
}

/**
 * Niveau du garde-fou anti-boucle pour une relance déterministe :
 * `ask` = première relance, `reformulate` = même question reformulée,
 * `escalate` = repli humain proposé pour ne pas boucler.
 */
export type DialogueStallLevel = 'ask' | 'reformulate' | 'escalate';

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
  /**
   * Origine des faits de réservation, liée à la valeur décrite : une origine
   * dont la valeur ne correspond plus au slot est ignorée.
   */
  slotProvenance?: Partial<
    Record<'date' | 'time' | 'partySize', { source: SlotProvenanceSource; value: string | number }>
  >;
  /** Demande d'horaires conservée pendant la collecte date/couverts. */
  wantsAvailabilityOptions?: boolean;
  /** Créneau de journée demandé (« le soir », « à midi »), utilisé pour filtrer les propositions. */
  dayPeriod?: DayPeriod;
  /** Échecs LLM consécutifs, remis à zéro par une réponse LLM réussie. */
  llmFailureStreak?: number;
  /**
   * Deux valeurs phonétiquement proches pour la question en cours (« six ou
   * dix ? »). Posé par `recordUserTurn`, consommé par la réponse du tour.
   */
  answerChoice?: { kind: 'partySize' | 'weekday' | 'time'; values: [string, string] } | null;
  /** Valeurs retenues au dernier tour, relues naturellement dans la question suivante. */
  justFilled?: { partySize?: boolean; date?: boolean } | null;
  offeredAvailability?: { date: string; partySize: number; slots: string[] };
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
  /** Historique borné des interactions ouvertes, suspendues ou terminées. */
  pendingInteractions: PendingInteraction[];
  nextPendingInteractionId: number;
  /** Clé du dernier récapitulatif de réservation qui attend un accord explicite. */
  pendingReservationConfirmationKey: string | null;
  /** Clé du brouillon accepté explicitement, consommée à la création. */
  confirmedReservationKey: string | null;
  /** Nom épelé détecté, en attente de confirmation explicite par l'appelant. */
  spellingCandidate: string | null;
  nameCollection: NameCollection;
  misunderstandingCount: number;
  /** Relances déterministes consécutives sur la même question sans progrès. */
  stalledTurns: number;
  /** Question actuellement relancée, pour détecter la répétition. */
  stallSignature: string | null;
  /** Vrai tant qu'une proposition de message/transfert attend une réponse. */
  humanFallbackOffered: boolean;
  /** Permet de ne jamais convertir un « oui » en choix entre deux actions. */
  humanFallbackMode: HumanFallbackMode;
  /** Dernière décision du garde-fou anti-boucle, consommée par la télémétrie. */
  lastDialogueGuard: { key: string; level: DialogueStallLevel; count: number } | null;
  closing: boolean;
}

/** Contrat minimal du contexte Cartesia actif, sans coupler le manager au transport. */
export interface ActiveTtsContext {
  cancel(): void;
}

/** Compteurs internes de consommation des providers d'un appel. */
export interface VoiceUsageLlmCounter {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface VoiceUsageCounters {
  sttAudioSamples: number;
  cartesiaTtsCharacters: number;
  llmByProvider: Record<string, Record<string, VoiceUsageLlmCounter>>;
  finalization?: Promise<void>;
}

/** Chemin réellement emprunté par un tour, après exécution. */
export type VoiceTurnPath = 'unknown' | 'deterministic' | 'llm' | 'availability' | 'fallback';

export interface VoiceTurnLatencyTrace {
  startTime: number;
  /** Horodatages/durées ajoutés pour la chronologie de diagnostic. */
  speechStartedAt?: number;
  speechDurationMs?: number;
  sttFinalAt?: number;
  sttFinalMs?: number;
  llmFirstTokenMs?: number;
  llmFirstPhraseMs?: number;
  llmCompletedMs?: number;
  availabilityDurationMs?: number;
  ttsSynthesisStartedAt?: number;
  ttsFirstByteMs?: number;
  audioSentAt?: number;
  ttsCompletedMs?: number;
  interruptedAt?: number;
  totalE2eMs?: number;
}

/** Identité minimisée du tour courant pour les logs d'observabilité. */
export interface VoiceTurnTelemetry {
  id: string;
  /** Position du tour dans l'appel, indépendante de turnCount métier. */
  sequence: number;
  startedAt: number;
  transcriptLength: number;
  transcriptFingerprint: string;
  path: VoiceTurnPath;
  availabilitySearches: number;
  availabilityFailures: number;
  loopDetected: boolean;
  interrupted?: boolean;
  completed: boolean;
  sttProvider?: string;
  llmProvider?: string;
  llmModel?: string;
  ttsProvider?: string;
  /** Snapshot partagé avec la trace héritée, pour ne jamais perdre un tour. */
  latencyTrace?: VoiceTurnLatencyTrace;
  /** Dernier début de recherche, utilisé pour calculer sa durée. */
  availabilityStartedAt?: number;
  endedAt?: number;
  /** Numéro monotone des événements structurés de ce tour. */
  eventSequence?: number;
  /** Dialogue du tour, rempli seulement pour les restaurants de test. */
  debugDialogue?: VoiceTurnDebugDialogue;
}

/** Paroles d'un tour (appels de test uniquement, cf. debug-dialogue.ts). */
export interface VoiceTurnDebugDialogue {
  callerText?: string;
  speechAct?: string;
  agentSpeech: DebugSpeechEntry[];
  fillers: DebugSpeechEntry[];
  tools: string[];
}

/**
 * Réplique de l'agent et sort de son audio, fixé en fin de lecture d'après les
 * trames envoyées à Telnyx pour cette seule réplique. Envoyé ne veut pas dire
 * entendu : une interruption peut encore vider l'audio en attente côté Telnyx.
 */
export interface DebugSpeechEntry {
  text: string;
  status: 'pending' | 'sent' | 'partially_sent' | 'not_sent';
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
  | {
      type: 'Unavailable';
      reason: 'auth' | 'quota' | 'terms' | 'connection' | 'configuration';
      message: string;
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

/** Message de chat au format OpenAI-compatible (Groq). */
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
  /** La page Connect publique du restaurant est actuellement publiée. */
  onlineReservationsActive?: boolean;
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
  /** Échecs consécutifs d’ouverture/fermeture avant une connexion STT stable. */
  sttConsecutiveFailures?: number;
  /** Reconnexions Scribe déjà tentées pendant cet appel (l'ouverture initiale exclue). */
  sttReconnectAttempts?: number;
  sttRetryTimer?: ReturnType<typeof setTimeout> | null;
  sttConnectTimeout?: ReturnType<typeof setTimeout> | null;
  sttConnectionDeadlineTimer?: ReturnType<typeof setTimeout> | null;
  /** Arrêt définitif de la reconnexion après erreur terminale ou repli parlé. */
  sttTerminalFailure?: boolean;
  sttFallbackTriggered?: boolean;
  sttFallbackSpoken?: boolean;
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
  /** Dernière phrase appelant envoyée au traitement (déterministe ou LLM). */
  lastProcessedTranscript?: string;
  /**
   * Phrase dont la réponse a été annulée par une reprise de parole. Elle est
   * fusionnée avec la suite, ou retraitée seule si aucune suite n'arrive.
   */
  interruptedTurn?: { transcript: string; timer: ReturnType<typeof setTimeout> } | null;
  /** Timer de grâce pour une fin de tour reçue pendant une épellation. */
  sttEndOfTurnTimer?: ReturnType<typeof setTimeout> | null;
  /** Fin de tour retenue parce que la phrase semble inachevée. */
  sttSemanticHold?: {
    transcript: string;
    words?: SttWord[];
    languageCode?: string;
    holdMs: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null;
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
  /** Tours précédents conservés jusqu'à la finalisation de l'appel. */
  voiceTurnHistory?: VoiceTurnTelemetry[];
  /** Bilan runtime, alimenté à partir des faits et persisté en fin d'appel. */
  voiceCallTelemetry?: {
    finalizedAt?: number;
    reservationConfirmed?: boolean;
    reservationIntentAbandoned?: boolean;
  };
  /** Sérialise les snapshots DB déclenchés par TTS, stop et fermeture WS. */
  voiceTelemetryPersistence?: Promise<void>;
  /** Révisions des tours déjà confirmées en base ; les échecs restent rejouables. */
  voiceTelemetryPersistedTurns?: Record<string, string>;
  /** Compteurs de coût providers, gardés en mémoire puis persistés à la fin. */
  voiceUsage?: VoiceUsageCounters;

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
  latencyTrace?: VoiceTurnLatencyTrace;
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
