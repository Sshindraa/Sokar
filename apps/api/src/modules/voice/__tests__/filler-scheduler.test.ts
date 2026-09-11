import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';

const { mockPlayFiller, mockRecordVoiceTurnEvent } = vi.hoisted(() => ({
  mockPlayFiller: vi.fn().mockResolvedValue(undefined),
  mockRecordVoiceTurnEvent: vi.fn(),
}));

vi.mock('../stream/fillers-cache', () => ({ playFiller: mockPlayFiller }));
vi.mock('../stream/turn-telemetry', () => ({ recordVoiceTurnEvent: mockRecordVoiceTurnEvent }));

import {
  cancelScheduledFiller,
  scheduleThinkingFiller,
  THINKING_FILLER_DELAY_MS,
} from '../stream/filler-scheduler';

function makeSession(): CallSession {
  return {
    callControlId: 'cc-filler-scheduler',
    state: 'PROCESSING',
    ended: false,
    ending: null,
    telnyxWs: { readyState: WebSocket.OPEN },
    currentTurn: {
      id: 'turn-filler',
      startedAt: Date.now(),
      transcriptLength: 0,
      transcriptFingerprint: 'test',
    },
  } as unknown as CallSession;
}

describe('filler scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attend avant de jouer et reste occasionnel', async () => {
    const session = makeSession();

    scheduleThinkingFiller(session, 'CASUAL', {
      probability: 1,
      random: () => 0,
    });

    expect(mockPlayFiller).not.toHaveBeenCalled();
    vi.advanceTimersByTime(THINKING_FILLER_DELAY_MS - 1);
    expect(mockPlayFiller).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(mockPlayFiller).toHaveBeenCalledOnce();
    expect(mockPlayFiller.mock.calls[0]?.[3]).toMatchObject({ randomize: true });
    expect(mockRecordVoiceTurnEvent).toHaveBeenCalledWith(
      session,
      'filler_started',
      expect.objectContaining({ purpose: 'thinking' }),
    );
  });

  it('annule le délai avant tout envoi audio', () => {
    const session = makeSession();

    scheduleThinkingFiller(session, 'CASUAL', { probability: 1, random: () => 0 });
    cancelScheduledFiller(session);
    vi.advanceTimersByTime(THINKING_FILLER_DELAY_MS + 1_000);

    expect(mockPlayFiller).not.toHaveBeenCalled();
  });

  it('n’envoie pas de filler si la réponse arrive avant le délai', () => {
    const session = makeSession();

    scheduleThinkingFiller(session, 'CASUAL', { probability: 1, random: () => 0 });
    session.state = 'SPEAKING';
    vi.advanceTimersByTime(THINKING_FILLER_DELAY_MS);

    expect(mockPlayFiller).not.toHaveBeenCalled();
  });

  it('signale une interruption si la lecture est déjà commencée', async () => {
    const session = makeSession();
    mockPlayFiller.mockImplementationOnce(() => new Promise<void>(() => undefined));

    scheduleThinkingFiller(session, 'CASUAL', {
      probability: 1,
      random: () => 0,
      delayMs: 10,
    });
    vi.advanceTimersByTime(10);
    await Promise.resolve();
    const options = mockPlayFiller.mock.calls[0]?.[3] as { signal: AbortSignal };

    cancelScheduledFiller(session);

    expect(options.signal.aborted).toBe(true);
    expect(mockRecordVoiceTurnEvent).toHaveBeenCalledWith(session, 'filler_interrupted', {
      purpose: 'thinking',
    });
  });

  it('respecte la probabilité configurée', () => {
    const session = makeSession();

    scheduleThinkingFiller(session, 'CASUAL', { probability: 0, random: () => 0 });
    vi.advanceTimersByTime(THINKING_FILLER_DELAY_MS + 1_000);

    expect(mockPlayFiller).not.toHaveBeenCalled();
  });
});
