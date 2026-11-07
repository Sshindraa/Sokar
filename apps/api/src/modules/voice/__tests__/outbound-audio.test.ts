import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';

vi.mock('../../../shared/logger/pino', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../../../shared/logger/pino';
import {
  inactiveReason,
  logAudioOutSummary,
  noteAudioDropped,
  noteAudioFrameSent,
} from '../stream/outbound-audio';

function makeSession(over: Partial<CallSession> = {}): CallSession {
  return {
    callControlId: 'call-1',
    codec: 'PCMA',
    state: 'SPEAKING',
    ended: false,
    ttsGeneration: 1,
    telnyxWs: { readyState: WebSocket.OPEN, bufferedAmount: 0 },
    ...over,
  } as unknown as CallSession;
}

describe('outbound audio proof', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts sent frames, logs only the first one, and reports totals at call end', () => {
    const session = makeSession();
    noteAudioFrameSent(session, 800);
    noteAudioFrameSent(session, 800);

    expect(logger.info).toHaveBeenCalledTimes(1);
    logAudioOutSummary(session);
    expect(logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ framesSent: 2, bytesSent: 1600, framesDropped: 0 }),
      '[audio-out] call summary',
    );
  });

  it('reports why audio was dropped (state left SPEAKING after a barge-in)', () => {
    const session = makeSession({ state: 'LISTENING' });
    noteAudioDropped(session, 12, 1);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ droppedFrames: 12, reason: 'state_LISTENING' }),
      '[audio-out] frames dropped before sending',
    );
  });

  it('names each reason and ignores empty drops', () => {
    expect(inactiveReason(makeSession({ ended: true }))).toBe('ended');
    expect(
      inactiveReason(
        makeSession({ telnyxWs: { readyState: WebSocket.CLOSED } as unknown as WebSocket }),
      ),
    ).toBe(`ws_readyState_${WebSocket.CLOSED}`);
    expect(inactiveReason(makeSession(), 2)).toBe('tts_generation_changed');

    noteAudioDropped(makeSession(), 0);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
