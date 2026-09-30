import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSession } from '../stream/types';
import {
  firstAudioHoldCapMs,
  firstAudioSilenceMs,
  holdFirstAudioForCallerSilence,
} from '../stream/first-audio-hold';

const { fakeSockets, FakeSocket } = vi.hoisted(() => {
  const sockets: Array<{
    readyState: number;
    handlers: Record<string, (...args: unknown[]) => void>;
  }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    handlers: Record<string, (...args: unknown[]) => void> = {};
    constructor() {
      sockets.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers[event] = handler;
      return this;
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
    }
  }
  return { fakeSockets: sockets, FakeSocket: Socket };
});
vi.mock('ws', () => ({ WebSocket: FakeSocket }));

function makeSession(lastVoiceAt?: number): CallSession {
  return {
    codec: 'PCMA',
    state: 'SPEAKING',
    ended: false,
    ttsGeneration: 0,
    telnyxWs: { readyState: 1, send: vi.fn() },
    ...(lastVoiceAt === undefined
      ? {}
      : { callerVoice: { noiseFloor: 0, voiceRun: 2, lastVoiceAt } }),
  } as unknown as CallSession;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T16:00:00Z'));
  fakeSockets.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('réglages', () => {
  it('600 ms de silence et 1,2 s de plafond par défaut, 0 désactive, valeurs absurdes ignorées', () => {
    expect(firstAudioSilenceMs({})).toBe(600);
    expect(firstAudioSilenceMs({ VOICE_FIRST_AUDIO_SILENCE_MS: '0' })).toBe(0);
    expect(firstAudioSilenceMs({ VOICE_FIRST_AUDIO_SILENCE_MS: '99999' })).toBe(600);
    expect(firstAudioHoldCapMs({})).toBe(1_200);
    expect(firstAudioHoldCapMs({ VOICE_FIRST_AUDIO_HOLD_CAP_MS: '10' })).toBe(1_200);
  });
});

describe('holdFirstAudioForCallerSilence', () => {
  it('laisse partir tout de suite quand l’appelant n’a jamais parlé ou se tait depuis assez longtemps', async () => {
    const never = await holdFirstAudioForCallerSilence(makeSession(), () => true);
    expect(never).toEqual({ outcome: 'released_immediate', heldMs: 0 });
    const quiet = await holdFirstAudioForCallerSilence(makeSession(Date.now() - 900), () => true);
    expect(quiet.outcome).toBe('released_immediate');
  });

  it('retient jusqu’à 600 ms de silence, puis libère', async () => {
    const session = makeSession(Date.now() - 200);
    const pending = holdFirstAudioForCallerSilence(session, () => true);
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    expect(result.outcome).toBe('released_after_hold');
    expect(result.heldMs).toBeGreaterThanOrEqual(400);
    expect(result.heldMs).toBeLessThan(500);
  });

  it('annule sans rien dire quand l’appelant reprend la parole pendant l’attente (appel 5cebe456)', async () => {
    const session = makeSession(Date.now() - 200);
    const pending = holdFirstAudioForCallerSilence(session, () => true);
    await vi.advanceTimersByTimeAsync(100);
    session.callerVoice!.lastVoiceAt = Date.now();
    await vi.advanceTimersByTimeAsync(40);
    expect((await pending).outcome).toBe('cancelled_voice_resumed');
  });

  it('annule aussi si l’appelant parlait encore quand la réponse était prête', async () => {
    const session = makeSession(Date.now() - 10);
    const pending = holdFirstAudioForCallerSilence(session, () => true);
    await vi.advanceTimersByTimeAsync(20);
    session.callerVoice!.lastVoiceAt = Date.now();
    await vi.advanceTimersByTimeAsync(30);
    expect((await pending).outcome).toBe('cancelled_voice_resumed');
  });

  it('rend la main au plafond quand le silence exigé ne peut pas être atteint', async () => {
    vi.stubEnv('VOICE_FIRST_AUDIO_SILENCE_MS', '2000');
    vi.stubEnv('VOICE_FIRST_AUDIO_HOLD_CAP_MS', '500');
    const pending = holdFirstAudioForCallerSilence(makeSession(Date.now() - 100), () => true);
    await vi.advanceTimersByTimeAsync(600);
    expect((await pending).outcome).toBe('released_at_cap');
  });

  it('ne retient rien quand la garde est désactivée, et s’arrête si le tour est périmé', async () => {
    vi.stubEnv('VOICE_FIRST_AUDIO_SILENCE_MS', '0');
    expect(
      (await holdFirstAudioForCallerSilence(makeSession(Date.now()), () => true)).outcome,
    ).toBe('released_immediate');
    vi.unstubAllEnvs();
    let live = true;
    const pending = holdFirstAudioForCallerSilence(makeSession(Date.now() - 100), () => live);
    await vi.advanceTimersByTimeAsync(40);
    live = false;
    await vi.advanceTimersByTimeAsync(40);
    expect((await pending).outcome).toBe('aborted');
  });
});

describe('contexte Cartesia : aucun son avant le silence exigé', () => {
  async function setup(lastVoiceAt: number | undefined) {
    vi.stubEnv('CARTESIA_API_KEY', 'test-key');
    const { createCartesiaContextTurn } = await import('../stream/cartesia-context');
    const session = makeSession(lastVoiceAt);
    const turn = createCartesiaContextTurn(session, true)!;
    const socket = fakeSockets[0];
    socket.handlers.open?.();
    turn.push('Bonjour. Pour quel jour ?');
    // 100 ms d'audio A-law, le format d'une trame de lecture.
    const audio = Buffer.alloc(1_600, 0xd5).toString('base64');
    socket.handlers.message?.(JSON.stringify({ type: 'chunk', data: audio }));
    return { session, turn };
  }
  const mediaSent = (session: CallSession) =>
    vi
      .mocked(session.telnyxWs.send)
      .mock.calls.filter(([message]) => String(message).includes('"media"')).length;

  it('retient le premier son, puis le joue une fois l’appelant silencieux', async () => {
    const { session, turn } = await setup(Date.now() - 200);
    await vi.advanceTimersByTimeAsync(200);
    expect(mediaSent(session)).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(mediaSent(session)).toBeGreaterThan(0);
    turn.cancel();
  });

  it('jette la réponse préparée sans envoyer un mot quand l’appelant reprend', async () => {
    const { session, turn } = await setup(Date.now() - 200);
    const cancelled = vi.fn();
    turn.onHoldCancelled = cancelled;
    await vi.advanceTimersByTimeAsync(100);
    session.callerVoice!.lastVoiceAt = Date.now();
    await vi.advanceTimersByTimeAsync(600);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(mediaSent(session)).toBe(0);
  });

  it('ne joue plus rien pendant une pause, et reprend là où il en était', async () => {
    const { session, turn } = await setup(Date.now() - 2_000);
    await vi.advanceTimersByTimeAsync(40);
    const before = mediaSent(session);
    expect(before).toBeGreaterThan(0);
    turn.pause();
    await vi.advanceTimersByTimeAsync(400);
    const during = mediaSent(session);
    // Au plus la trame déjà partie : la pause agit dans les 100 ms d'une trame.
    expect(during - before).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(mediaSent(session)).toBe(during);
    turn.resume();
    await vi.advanceTimersByTimeAsync(200);
    expect(mediaSent(session)).toBeGreaterThan(during);
    turn.cancel();
  });

  it('joue tout de suite quand l’appelant se tait depuis longtemps', async () => {
    const { session, turn } = await setup(Date.now() - 2_000);
    await vi.advanceTimersByTimeAsync(40);
    expect(mediaSent(session)).toBeGreaterThan(0);
    turn.cancel();
  });
});
