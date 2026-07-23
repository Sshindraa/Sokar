import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSession } from '../stream/types';

vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn() },
}));

import { logger } from '../../../shared/logger/pino';
import {
  recordVoiceTurnClassification,
  recordVoiceTurnEvent,
  recordVoiceTurnFirstAudio,
  recordVoiceTurnLlmFirstToken,
  recordVoiceTurnTtsFirstByte,
  startVoiceTurn,
} from '../stream/turn-telemetry';

function makeSession(): CallSession {
  return {
    callControlId: 'call-telemetry-1',
    currentTurn: null,
    conversation: { intent: 'reservation', pendingQuestion: 'time' },
  } as CallSession;
}

describe('voice turn telemetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a stable opaque id and never logs the transcript in plain text', () => {
    const session = makeSession();
    const transcript = 'Je voudrais réserver demain pour deux personnes.';

    startVoiceTurn(session, transcript);
    recordVoiceTurnClassification(session, 'content');
    recordVoiceTurnEvent(session, 'availability_completed', { durationMs: 125 });

    expect(session.currentTurn?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.currentTurn?.transcriptLength).toBe(transcript.length);
    expect(session.currentTurn?.transcriptFingerprint).toHaveLength(12);
    const logs = vi.mocked(logger.info).mock.calls.map(([payload]) => JSON.stringify(payload));
    expect(logs.some((entry) => entry.includes(transcript))).toBe(false);
    expect(logs.some((entry) => entry.includes('availability_completed'))).toBe(false);
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(3);
  });

  it('journalise chaque jalon une seule fois pour chaque nouveau tour', () => {
    const session = makeSession();

    startVoiceTurn(session, 'Premier tour');
    recordVoiceTurnLlmFirstToken(session);
    recordVoiceTurnLlmFirstToken(session);
    recordVoiceTurnTtsFirstByte(session);
    recordVoiceTurnFirstAudio(session);

    startVoiceTurn(session, 'Deuxième tour');
    recordVoiceTurnTtsFirstByte(session);
    recordVoiceTurnFirstAudio(session);

    const messages = vi.mocked(logger.info).mock.calls.map(([, message]) => message);
    expect(messages.filter((message) => message === '[voice-turn] llm_first_token')).toHaveLength(
      1,
    );
    expect(messages.filter((message) => message === '[voice-turn] tts_first_byte')).toHaveLength(2);
    expect(messages.filter((message) => message === '[voice-turn] tts_first_audio')).toHaveLength(
      2,
    );
  });
});
