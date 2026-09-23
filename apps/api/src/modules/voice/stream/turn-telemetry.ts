import { createHash, randomUUID } from 'node:crypto';
import type {
  CallSession,
  SttWord,
  VoiceSpeechAct,
  VoiceTurnLatencyTrace,
  VoiceTurnTelemetry,
  VoiceTurnPath,
} from './types';
import { logger } from '../../../shared/logger/pino';
import {
  voiceTurnDurationMs,
  voiceLlmFirstTokenMs,
  voiceLlmFirstPhraseMs,
  voiceTtsFirstAudioMs,
} from '../../../shared/observability/metrics';
import { getVoiceLlmModel, getVoiceLlmProvider } from '../llm-provider';

export type VoiceTurnPhase =
  | 'speech'
  | 'transcription'
  | 'generation'
  | 'availability'
  | 'synthesis'
  | 'audio'
  | 'interruption';

export type VoiceTurnEvent =
  | 'started'
  | 'speech_resumed'
  | 'stt_final'
  | 'classified'
  | 'llm_started'
  | 'llm_first_token'
  | 'llm_first_phrase'
  | 'llm_phrase_generated'
  | 'llm_completed'
  | 'llm_interrupted'
  | 'speculation_hit'
  | 'turn_plan_shadow'
  | 'availability_started'
  | 'availability_completed'
  | 'availability_failed'
  | 'dialogue_guard'
  | 'filler_started'
  | 'filler_completed'
  | 'filler_interrupted'
  | 'tts_synthesis_started'
  | 'tts_synthesis_first_byte'
  | 'tts_synthesis_completed'
  | 'tts_first_audio'
  | 'tts_completed'
  | 'tts_interrupted'
  | 'barge_in'
  | 'goodbye_filler_hit';

export type VoiceTurnEventFields = Record<string, boolean | number | string | null | undefined>;

function transcriptFingerprint(transcript: string): string {
  return createHash('sha256').update(transcript).digest('hex').slice(0, 12);
}

function cloneLatencyTrace(
  trace: VoiceTurnLatencyTrace | undefined,
): VoiceTurnLatencyTrace | undefined {
  return trace ? { ...trace } : undefined;
}

/**
 * Archive le tour précédent avant que le prochain tour ne remplace la trace
 * runtime. La copie est volontaire : les callbacks LLM/TTS tardifs ne doivent
 * jamais modifier l'historique déjà observé.
 */
function archiveCurrentVoiceTurn(session: CallSession, endedAt = Date.now()): void {
  const current = session.currentTurn;
  if (!current) return;
  current.endedAt ??= endedAt;
  current.completed ||= Boolean(current.latencyTrace?.audioSentAt);
  current.latencyTrace = cloneLatencyTrace(session.latencyTrace);
  const history = session.voiceTurnHistory ?? (session.voiceTurnHistory = []);
  const existing = history.findIndex((turn) => turn.id === current.id);
  const snapshot = {
    ...current,
    latencyTrace: cloneLatencyTrace(current.latencyTrace),
  };
  if (existing >= 0) history[existing] = snapshot;
  else history.push(snapshot);
}

function currentPath(session: CallSession): VoiceTurnPath {
  return session.currentTurn?.path ?? 'unknown';
}

/**
 * Définit le chemin primaire du tour en conservant les chemins plus
 * informatifs lorsqu'un tour combine disponibilité et LLM.
 */
function setVoiceTurnPath(session: CallSession, next: VoiceTurnPath): void {
  const turn = session.currentTurn;
  if (!turn) return;
  const current = currentPath(session);
  if (next === 'fallback' || current === 'fallback') turn.path = 'fallback';
  else if (next === 'availability' || current === 'availability') turn.path = 'availability';
  else if (next === 'llm' || current === 'llm') turn.path = 'llm';
  else if (next !== 'unknown') turn.path = next;
}

function phaseForEvent(event: VoiceTurnEvent): VoiceTurnPhase {
  switch (event) {
    case 'started':
    case 'speech_resumed':
      return 'speech';
    case 'stt_final':
    case 'classified':
      return 'transcription';
    case 'llm_started':
    case 'llm_first_token':
    case 'llm_first_phrase':
    case 'llm_phrase_generated':
    case 'llm_completed':
    case 'llm_interrupted':
    case 'speculation_hit':
    case 'turn_plan_shadow':
    case 'dialogue_guard':
      return 'generation';
    case 'availability_started':
    case 'availability_completed':
    case 'availability_failed':
      return 'availability';
    case 'filler_started':
    case 'filler_completed':
    case 'filler_interrupted':
    case 'tts_synthesis_started':
    case 'tts_synthesis_first_byte':
    case 'tts_synthesis_completed':
    case 'tts_completed':
    case 'goodbye_filler_hit':
      return 'synthesis';
    case 'tts_first_audio':
      return 'audio';
    case 'tts_interrupted':
    case 'barge_in':
      return 'interruption';
  }
}

/**
 * Démarre la mesure dès que le STT détecte la prise de parole.
 * Le transcript peut être vide : il sera enrichi au commit final.
 */
export function startVoiceTurn(session: CallSession, transcript = ''): void {
  archiveCurrentVoiceTurn(session);
  const startedAt = Date.now();
  const latencyTrace: VoiceTurnLatencyTrace = {
    startTime: startedAt,
    speechStartedAt: startedAt,
  };
  const sequence = (session.voiceTurnHistory?.length ?? 0) + 1;
  session.currentTurn = {
    id: randomUUID(),
    sequence,
    startedAt,
    transcriptLength: transcript.length,
    transcriptFingerprint: transcriptFingerprint(transcript),
    path: 'unknown',
    availabilitySearches: 0,
    availabilityFailures: 0,
    loopDetected: false,
    completed: false,
    sttProvider: session.sttModel,
    latencyTrace,
    eventSequence: 0,
  };
  // La trace legacy reste bornée au tour courant pour les consommateurs
  // existants ; l'historique séparé est persisté par session-persistence.
  session.latencyTrace = latencyTrace;
  recordVoiceTurnEvent(session, 'started');
}

/**
 * Attache la transcription finale au tour commencé par UtteranceStart.
 * Le fallback startVoiceTurn couvre les commits courts sans partial observable.
 */
export function completeVoiceTurnInput(
  session: CallSession,
  transcript: string,
  words: SttWord[] = [],
): void {
  if (!session.currentTurn) startVoiceTurn(session);
  const turn = session.currentTurn;
  if (!turn) return;

  const completedAt = Date.now();
  turn.transcriptLength = transcript.length;
  turn.transcriptFingerprint = transcriptFingerprint(transcript);
  if (session.latencyTrace) {
    session.latencyTrace.sttFinalAt = completedAt;
    session.latencyTrace.sttFinalMs = completedAt - session.latencyTrace.startTime;
    const wordStarts = words
      .map((word) => word.start)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const wordEnds = words
      .map((word) => word.end)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (wordStarts.length > 0 && wordEnds.length > 0) {
      const durationMs = Math.max(0, (Math.max(...wordEnds) - Math.min(...wordStarts)) * 1000);
      session.latencyTrace.speechDurationMs = Math.round(durationMs);
    }
  }
  recordVoiceTurnEvent(session, 'stt_final', {
    sttFinalMs: session.latencyTrace?.sttFinalMs ?? 0,
    speechDurationMs: session.latencyTrace?.speechDurationMs ?? null,
    transcriptLength: transcript.length,
  });
}

export function recordVoiceTurnClassification(
  session: CallSession,
  speechAct: VoiceSpeechAct,
): void {
  recordVoiceTurnEvent(session, 'classified', {
    speechAct,
    intent: session.conversation.intent,
    pendingQuestion: session.conversation.pendingQuestion,
  });
}

/** Évite de rattacher la fin d'un ancien pipeline au tour suivant. */
export function isCurrentVoiceTurn(session: CallSession, turnId?: string): boolean {
  return !turnId || session.currentTurn?.id === turnId;
}

export function recordVoiceTurnEventIfCurrent(
  session: CallSession,
  turnId: string | undefined,
  event: VoiceTurnEvent,
  fields: VoiceTurnEventFields = {},
): void {
  if (!isCurrentVoiceTurn(session, turnId)) return;
  recordVoiceTurnEvent(session, event, fields);
}

/** Mesure le premier delta de contenu réellement reçu du modèle. */
export function markVoiceTurnLlmFirstToken(
  session: CallSession,
  turnId?: string,
): number | undefined {
  if (!isCurrentVoiceTurn(session, turnId)) return undefined;
  const trace = session.latencyTrace;
  if (!trace || trace.llmFirstTokenMs !== undefined) return trace?.llmFirstTokenMs;
  const elapsedMs = Date.now() - trace.startTime;
  trace.llmFirstTokenMs = elapsedMs;
  recordVoiceTurnEvent(session, 'llm_first_token', {
    llmFirstTokenMs: elapsedMs,
  });
  return elapsedMs;
}

/** Mesure la première phrase complète remise au pipeline TTS. */
export function markVoiceTurnLlmFirstPhrase(
  session: CallSession,
  turnId?: string,
): number | undefined {
  if (!isCurrentVoiceTurn(session, turnId)) return undefined;
  const trace = session.latencyTrace;
  if (!trace || trace.llmFirstPhraseMs !== undefined) return trace?.llmFirstPhraseMs;
  const elapsedMs = Date.now() - trace.startTime;
  trace.llmFirstPhraseMs = elapsedMs;
  recordVoiceTurnEvent(session, 'llm_first_phrase', {
    llmFirstPhraseMs: elapsedMs,
  });
  return elapsedMs;
}

/** Mesure le premier octet produit par la synthèse, avant son envoi RTP. */
export function markVoiceTurnTtsSynthesisFirstByte(
  session: CallSession,
  source: string,
  turnId?: string,
): number | undefined {
  if (!isCurrentVoiceTurn(session, turnId)) return undefined;
  const trace = session.latencyTrace;
  if (!trace) return undefined;
  if (trace.ttsFirstByteMs !== undefined) return trace.ttsFirstByteMs;
  const elapsedMs = Date.now() - trace.startTime;
  trace.ttsFirstByteMs = elapsedMs;
  recordVoiceTurnEvent(session, 'tts_synthesis_first_byte', {
    source,
    ttsFirstByteMs: elapsedMs,
  });
  return elapsedMs;
}

/** Mesure le premier frame effectivement envoyé au Media Stream Telnyx. */
export function markVoiceTurnAudioSent(
  session: CallSession,
  fields: VoiceTurnEventFields = {},
  turnId?: string,
): void {
  if (!isCurrentVoiceTurn(session, turnId)) return;
  const trace = session.latencyTrace;
  if (!trace || trace.totalE2eMs !== undefined) return;
  const sentAt = Date.now();
  trace.audioSentAt = sentAt;
  trace.totalE2eMs = sentAt - trace.startTime;
  recordVoiceTurnEvent(session, 'tts_first_audio', {
    ...fields,
    ttsFirstByteMs: trace.ttsFirstByteMs ?? null,
    totalE2eMs: trace.totalE2eMs,
  });
}

export function recordVoiceTurnEvent(
  session: CallSession,
  event: VoiceTurnEvent,
  fields: VoiceTurnEventFields = {},
): void {
  const turn = session.currentTurn;
  if (!turn) return;
  const eventAt = Date.now();
  const elapsedMs = eventAt - turn.startedAt;
  turn.eventSequence = (turn.eventSequence ?? 0) + 1;
  const compactFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const phase = phaseForEvent(event);

  // Le runtime conserve les jalons utiles au dernier tour pour la persistance
  // et les outils de diagnostic. La chronologie exhaustive reste dans le log
  // structuré ci-dessous.
  const trace = session.latencyTrace;
  if (trace) {
    if (turn.latencyTrace !== trace) turn.latencyTrace = trace;
    switch (event) {
      case 'llm_started':
        setVoiceTurnPath(session, 'llm');
        turn.llmProvider =
          typeof fields.provider === 'string' ? fields.provider : getVoiceLlmProvider();
        turn.llmModel = typeof fields.model === 'string' ? fields.model : getVoiceLlmModel();
        break;
      case 'availability_started':
        setVoiceTurnPath(session, 'availability');
        // Un callback du fournisseur ou de l'orchestrateur peut être livré
        // deux fois. Tant qu'une recherche est déjà ouverte, ne pas compter
        // un second démarrage fantôme ni déplacer son point de départ.
        if (turn.availabilityStartedAt === undefined) {
          turn.availabilitySearches += 1;
          turn.availabilityStartedAt = eventAt;
        }
        break;
      case 'availability_completed':
        if (turn.availabilityStartedAt !== undefined) {
          const durationMs =
            typeof fields.durationMs === 'number'
              ? fields.durationMs
              : eventAt - turn.availabilityStartedAt;
          trace.availabilityDurationMs = (trace.availabilityDurationMs ?? 0) + durationMs;
          turn.availabilityStartedAt = undefined;
        }
        break;
      case 'availability_failed':
        if (turn.availabilityStartedAt !== undefined) {
          turn.availabilityFailures += 1;
          const durationMs =
            typeof fields.durationMs === 'number'
              ? fields.durationMs
              : eventAt - turn.availabilityStartedAt;
          trace.availabilityDurationMs = (trace.availabilityDurationMs ?? 0) + durationMs;
          turn.availabilityStartedAt = undefined;
        }
        break;
      case 'dialogue_guard': {
        const level = fields.level;
        if (level === 'escalate') {
          setVoiceTurnPath(session, 'fallback');
          turn.loopDetected = true;
        } else {
          setVoiceTurnPath(session, 'deterministic');
          if (level === 'reformulate') turn.loopDetected = true;
        }
        break;
      }
      case 'tts_synthesis_started':
        if (fields.source === 'native_fallback') setVoiceTurnPath(session, 'fallback');
        else if (currentPath(session) === 'unknown') setVoiceTurnPath(session, 'deterministic');
        turn.ttsProvider = fields.source === 'native_fallback' ? 'telnyx-native' : 'cartesia';
        trace.ttsSynthesisStartedAt ??= eventAt;
        break;
      case 'llm_interrupted':
        if (fields.reason === 'error') setVoiceTurnPath(session, 'fallback');
        break;
      case 'llm_completed':
        trace.llmCompletedMs =
          typeof fields.durationMs === 'number' ? fields.durationMs : elapsedMs;
        break;
      case 'tts_synthesis_first_byte':
        turn.ttsProvider = fields.source === 'native_fallback' ? 'telnyx-native' : 'cartesia';
        break;
      case 'tts_synthesis_completed':
      case 'tts_completed':
        if (fields.source === 'native_fallback') setVoiceTurnPath(session, 'fallback');
        trace.ttsCompletedMs =
          typeof fields.durationMs === 'number' ? fields.durationMs : elapsedMs;
        if (event === 'tts_completed') {
          turn.completed = true;
          turn.endedAt = eventAt;
        }
        break;
      case 'tts_interrupted':
      case 'barge_in':
        trace.interruptedAt = eventAt;
        turn.interrupted = true;
        break;
    }
  }

  // ─── Prometheus metrics (observation only, no alerting) ──────────
  // Les métriques sont observées au passage des events existants, sans
  // ajout de logique métier. Les labels restent à faible cardinalité.
  switch (event) {
    case 'llm_first_token': {
      const ttft = typeof fields.llmFirstTokenMs === 'number' ? fields.llmFirstTokenMs : elapsedMs;
      voiceLlmFirstTokenMs.observe(ttft);
      break;
    }
    case 'llm_first_phrase': {
      const firstPhraseMs =
        typeof fields.llmFirstPhraseMs === 'number' ? fields.llmFirstPhraseMs : elapsedMs;
      voiceLlmFirstPhraseMs.observe(firstPhraseMs);
      break;
    }
    case 'tts_first_audio': {
      const ttsMs = typeof fields.ttsFirstByteMs === 'number' ? fields.ttsFirstByteMs : elapsedMs;
      voiceTtsFirstAudioMs.observe(ttsMs);
      const totalMs = typeof fields.totalE2eMs === 'number' ? fields.totalE2eMs : elapsedMs;
      voiceTurnDurationMs.observe(totalMs);
      break;
    }
  }

  logger.info(
    {
      voiceTurn: {
        ...compactFields,
        callId: session.callControlId,
        turnId: turn.id,
        event,
        phase,
        sequence: turn.eventSequence,
        eventAt,
        elapsedMs,
        transcriptLength: turn.transcriptLength,
        transcriptFingerprint: turn.transcriptFingerprint,
      },
    },
    `[voice-turn] ${event}`,
  );
}

/** Retourne un instantané complet, incluant le tour encore actif. */
export function snapshotVoiceTurnTelemetry(session: CallSession): VoiceTurnTelemetry[] {
  archiveCurrentVoiceTurn(session);
  return (session.voiceTurnHistory ?? []).map((turn) => ({
    ...turn,
    latencyTrace: cloneLatencyTrace(turn.latencyTrace),
  }));
}
