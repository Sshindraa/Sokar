import { createHash, randomUUID } from 'node:crypto';
import type { CallSession, VoiceSpeechAct } from './types';
import { logger } from '../../../shared/logger/pino';

export type VoiceTurnEvent =
  | 'started'
  | 'classified'
  | 'llm_first_phrase'
  | 'speculation_hit'
  | 'availability_started'
  | 'availability_completed'
  | 'availability_failed'
  | 'filler_started'
  | 'filler_completed'
  | 'tts_first_audio'
  | 'barge_in'
  | 'goodbye_filler_hit';

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
  const startedAt = Date.now();
  session.currentTurn = {
    id: randomUUID(),
    startedAt,
    transcriptLength: transcript.length,
    transcriptFingerprint: transcriptFingerprint(transcript),
  };
  // Cette trace est volontairement bornée au tour courant. La persistance DB
  // reste un dernier état d'appel, tandis que les logs structurés gardent la
  // chronologie complète de chaque tour.
  session.latencyTrace = { startTime: startedAt, sttFinalMs: 0 };
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
