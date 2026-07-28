import { createHash, randomUUID } from 'node:crypto';
import type { CallSession, VoiceSpeechAct } from './types';
import { logger } from '../../../shared/logger/pino';
import {
  voiceTurnDurationMs,
  voiceLlmFirstTokenMs,
  voiceTtsFirstAudioMs,
} from '../../../shared/observability/metrics';

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
  const elapsedMs = Date.now() - turn.startedAt;
  const compactFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

  // ─── Prometheus metrics (observation only, no alerting) ──────────
  // Les métriques sont observées au passage des events existants, sans
  // ajout de logique métier. Les labels restent à faible cardinalité.
  switch (event) {
    case 'llm_first_phrase': {
      const ttft = typeof fields.llmFirstTokenMs === 'number' ? fields.llmFirstTokenMs : elapsedMs;
      voiceLlmFirstTokenMs.observe(ttft);
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
        callId: session.callControlId,
        turnId: turn.id,
        elapsedMs,
        transcriptLength: turn.transcriptLength,
        transcriptFingerprint: turn.transcriptFingerprint,
        ...compactFields,
      },
    },
    `[voice-turn] ${event}`,
  );
}
