import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSession } from '../stream/types';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    call: {
      findUnique: vi.fn(),
    },
    latencyTrace: {
      upsert: vi.fn(),
    },
    voiceCallTelemetry: {
      upsert: vi.fn(),
    },
    voiceTurnTelemetry: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/db/client', () => ({ db: mockDb }));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../../shared/sentry/client', () => ({ captureException: vi.fn() }));
vi.mock('../stream/debug-log', () => ({ writeDebugLog: vi.fn() }));

import {
  markVoiceTurnLlmFirstToken,
  markVoiceTurnAudioSent,
  recordVoiceTurnEvent,
  startVoiceTurn,
} from '../stream/turn-telemetry';
import { persistLatencyTrace } from '../stream/session-persistence';

function makeSession(): CallSession {
  return {
    callControlId: 'cc-persistence',
    callLegId: 'leg-persistence',
    callSessionId: 'cs-persistence',
    restaurantId: 'restaurant-1',
    transcript: '',
    ended: true,
    sttModel: 'elevenlabs-scribe-v2-realtime',
    currentTurn: null,
    voiceTurnHistory: [],
    voiceCallTelemetry: {},
    conversation: { intent: 'reservation', pendingQuestion: 'time' },
  } as unknown as CallSession;
}

describe('voice session persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.call.findUnique.mockResolvedValue({
      id: 'call-db-1',
      sttProvider: 'elevenlabs-scribe-v2-realtime',
      llmProvider: 'groq',
      ttsProvider: 'cartesia-sonic',
      intent: 'RESERVATION',
      outcome: null,
      reservation: null,
    });
  });

  it('persiste chaque tour et garde le premier jalon LLM dans le bilan', async () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      startVoiceTurn(session, 'Quels horaires ?');
      recordVoiceTurnEvent(session, 'llm_started');
      vi.advanceTimersByTime(125);
      markVoiceTurnLlmFirstToken(session);
      recordVoiceTurnEvent(session, 'tts_synthesis_started', { source: 'http_stream' });
      vi.advanceTimersByTime(25);
      markVoiceTurnAudioSent(session);
      recordVoiceTurnEvent(session, 'tts_completed', { durationMs: 90 });

      vi.advanceTimersByTime(20);
      startVoiceTurn(session, 'Merci');
      recordVoiceTurnEvent(session, 'tts_synthesis_started', { source: 'http_stream' });
      recordVoiceTurnEvent(session, 'tts_completed', { durationMs: 30 });

      await persistLatencyTrace(session);
      await persistLatencyTrace(session);

      expect(mockDb.voiceTurnTelemetry.upsert).toHaveBeenCalledTimes(2);
      const firstTurn = mockDb.voiceTurnTelemetry.upsert.mock.calls[0][0].create;
      const secondTurn = mockDb.voiceTurnTelemetry.upsert.mock.calls[1][0].create;
      expect(firstTurn).toMatchObject({
        path: 'llm',
        sequence: 1,
        llmFirstTokenMs: 125,
        llmProvider: 'groq',
        llmModel: expect.any(String),
      });
      expect(secondTurn).toMatchObject({ path: 'deterministic', sequence: 2 });
      expect(secondTurn.llmFirstTokenMs).toBeNull();
      expect(secondTurn.llmProvider).toBeNull();
      expect(secondTurn.llmModel).toBeNull();

      expect(mockDb.voiceCallTelemetry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            callId: 'call-db-1',
            firstLlmFirstTokenMs: 125,
            firstTtsFirstAudioMs: 150,
            llmProvider: 'groq',
            llmModel: expect.any(String),
            llmTurnCount: 1,
            deterministicTurnCount: 1,
            reservationIntentAbandoned: true,
          }),
        }),
      );
      expect(mockDb.latencyTrace.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ llmFirstToken: 125 }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
