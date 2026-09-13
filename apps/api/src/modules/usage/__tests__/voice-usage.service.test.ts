import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import type { CallSession } from '../../voice/stream/types';
import {
  addCartesiaTtsCharacters,
  addLlmUsage,
  addSttAudioSamples,
  ensureVoiceUsage,
  finalizeVoiceUsage,
} from '../voice-usage.service';

function makeSession(): CallSession {
  return {
    restaurantId: 'rest-1',
    callLegId: 'leg-1',
    callControlId: 'cc-1',
    callSessionId: 'cs-1',
    createdAt: Date.now() - 8_000,
    codec: 'PCMU',
    turnCount: 2,
    sttModel: 'scribe_v2_realtime',
  } as unknown as CallSession;
}

describe('voice usage counters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.outboxEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.outboxEvent.create).mockResolvedValue({ id: 'evt-created' } as never);
  });

  it('aggregates STT, Cartesia and per-provider/per-turn LLM usage once', async () => {
    const session = makeSession();
    addSttAudioSamples(session, 16_000);
    addCartesiaTtsCharacters(session, 120);
    addLlmUsage(session, 'cerebras', 'turn-1', 40, 12, true);
    addLlmUsage(session, 'cerebras', 'turn-1', 10, 3, false);

    await finalizeVoiceUsage(session);
    await finalizeVoiceUsage(session);

    const events = vi.mocked(db.outboxEvent.create).mock.calls.map(([call]) => call.data);
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.idempotencyKey)).toEqual(
      expect.arrayContaining([
        'elevenlabs:stt:leg-1:final',
        'cartesia:tts:leg-1:final',
        'cerebras:llm:leg-1:turn-1:input',
        'cerebras:llm:leg-1:turn-1:output',
      ]),
    );
    expect(
      events.find((event) => event.idempotencyKey === 'elevenlabs:stt:leg-1:final')?.payload,
    ).toMatchObject({
      quantity: 2,
      unit: 'seconds',
    });
    expect(ensureVoiceUsage(session).finalization).toBeDefined();
  });
});
