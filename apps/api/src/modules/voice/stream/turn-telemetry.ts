import { createHash, randomUUID } from 'node:crypto';
import type { CallSession, VoiceSpeechAct } from './types';
import { logger } from '../../../shared/logger/pino';

export type VoiceTurnEvent =
  | 'started'
  | 'classified'
  | 'response_selected'
  | 'availability_started'
  | 'availability_completed'
  | 'availability_failed'
  | 'filler_started'
  | 'filler_completed'
  | 'llm_first_token'
  | 'tts_first_byte'
  | 'tts_first_audio'
  | 'barge_in';

type EventFields = Record<string, boolean | number | string | null | undefined>;

function transcriptFingerprint(transcript: string): string {
  return createHash('sha256').update(transcript).digest('hex').slice(0, 12);
}

/**
 * Démarre un tour stable et n'écrit pas le transcript en clair dans les logs.
 * Le transcript complet reste déjà soumis aux règles de persistance de Call ;
 * ces événements servent au diagnostic du pipeline et minimisent les données.
 */
export function startVoiceTurn(session: CallSession, transcript: string): void {
  session.currentTurn = {
    id: randomUUID(),
    startedAt: Date.now(),
    transcriptLength: transcript.length,
    transcriptFingerprint: transcriptFingerprint(transcript),
  };
  recordVoiceTurnEvent(session, 'started');
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

export function recordVoiceTurnEvent(
  session: CallSession,
  event: VoiceTurnEvent,
  fields: EventFields = {},
): void {
  const turn = session.currentTurn;
  if (!turn) return;
  const compactFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  logger.info(
    {
      voiceTurn: {
        callId: session.callControlId,
        turnId: turn.id,
        elapsedMs: Date.now() - turn.startedAt,
        transcriptLength: turn.transcriptLength,
        transcriptFingerprint: turn.transcriptFingerprint,
        ...compactFields,
      },
    },
    `[voice-turn] ${event}`,
  );
}

export function recordVoiceTurnLlmFirstToken(session: CallSession): void {
  const turn = session.currentTurn;
  if (!turn || turn.llmFirstTokenAt !== undefined) return;
  turn.llmFirstTokenAt = Date.now();
  recordVoiceTurnEvent(session, 'llm_first_token', {
    llmFirstTokenMs: turn.llmFirstTokenAt - turn.startedAt,
  });
}

export function recordVoiceTurnTtsFirstByte(session: CallSession): void {
  const turn = session.currentTurn;
  if (!turn || turn.ttsFirstByteAt !== undefined) return;
  turn.ttsFirstByteAt = Date.now();
  recordVoiceTurnEvent(session, 'tts_first_byte', {
    ttsFirstByteMs: turn.ttsFirstByteAt - turn.startedAt,
  });
}

export function recordVoiceTurnFirstAudio(session: CallSession): void {
  const turn = session.currentTurn;
  if (!turn || turn.firstAudioAt !== undefined) return;
  turn.firstAudioAt = Date.now();
  recordVoiceTurnEvent(session, 'tts_first_audio', {
    totalE2eMs: turn.firstAudioAt - turn.startedAt,
  });
}
