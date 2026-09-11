import { createHash, randomUUID } from 'node:crypto';
import type { CallSession, VoiceSpeechAct } from './types';
import { logger } from '../../../shared/logger/pino';
import {
  voiceTurnDurationMs,
  voiceLlmFirstTokenMs,
  voiceLlmFirstPhraseMs,
  voiceTtsFirstAudioMs,
} from '../../../shared/observability/metrics';

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
  | 'availability_started'
  | 'availability_completed'
  | 'availability_failed'
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
  const startedAt = Date.now();
  session.currentTurn = {
    id: randomUUID(),
    startedAt,
    transcriptLength: transcript.length,
    transcriptFingerprint: transcriptFingerprint(transcript),
    eventSequence: 0,
  };
  // Cette trace est volontairement bornée au tour courant. La persistance DB
  // reste un dernier état d'appel, tandis que les logs structurés gardent la
  // chronologie complète de chaque tour.
  session.latencyTrace = {
    startTime: startedAt,
    speechStartedAt: startedAt,
  };
  recordVoiceTurnEvent(session, 'started');
}

/**
 * Attache la transcription finale au tour commencé par UtteranceStart.
 * Le fallback startVoiceTurn couvre les commits courts sans partial observable.
 */
export function completeVoiceTurnInput(session: CallSession, transcript: string): void {
  if (!session.currentTurn) startVoiceTurn(session);
  const turn = session.currentTurn;
  if (!turn) return;

  const completedAt = Date.now();
  turn.transcriptLength = transcript.length;
  turn.transcriptFingerprint = transcriptFingerprint(transcript);
  if (session.latencyTrace) {
    session.latencyTrace.sttFinalAt = completedAt;
    session.latencyTrace.sttFinalMs = completedAt - session.latencyTrace.startTime;
  }
  recordVoiceTurnEvent(session, 'stt_final', {
    sttFinalMs: session.latencyTrace?.sttFinalMs ?? 0,
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
    switch (event) {
      case 'llm_completed':
        trace.llmCompletedMs =
          typeof fields.durationMs === 'number' ? fields.durationMs : elapsedMs;
        break;
      case 'tts_synthesis_started':
        trace.ttsSynthesisStartedAt ??= eventAt;
        break;
      case 'tts_synthesis_completed':
      case 'tts_completed':
        trace.ttsCompletedMs =
          typeof fields.durationMs === 'number' ? fields.durationMs : elapsedMs;
        break;
      case 'tts_interrupted':
      case 'barge_in':
        trace.interruptedAt = eventAt;
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
