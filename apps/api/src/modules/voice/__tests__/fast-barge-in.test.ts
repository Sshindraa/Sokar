import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import {
  checkFastBargeIn,
  clearFastBargeIn,
  fastBargeInConfirmMs,
  fastBargeInMinRms,
  fastBargeInVoiceMs,
} from '../stream/fast-barge-in';

const LOUD = { rms: 2_000, chunkMs: 20 };
const QUIET = { rms: 100, chunkMs: 20 };

function setup(overrides: Partial<CallSession> = {}) {
  const pause = vi.fn();
  const resume = vi.fn();
  const session = {
    state: 'SPEAKING',
    ended: false,
    agentAudioActive: true,
    ttsContext: { cancel: vi.fn(), pause, resume },
    ...overrides,
  } as unknown as CallSession;
  const mgr = { handleBargeIn: vi.fn() } as unknown as CallSessionManager;
  return { session, mgr, pause, resume };
}
const feed = (session: CallSession, mgr: CallSessionManager, level: typeof LOUD, n: number) => {
  for (let i = 0; i < n; i++) checkFastBargeIn(session, level, mgr);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('réglages', () => {
  it('80 ms de voix, niveau 800, confirmation à 500 ms ; valeurs absurdes ignorées ; 0 désactive', () => {
    expect(fastBargeInVoiceMs({})).toBe(80);
    expect(fastBargeInVoiceMs({ VOICE_FAST_BARGE_IN_MS: '0' })).toBe(0);
    expect(fastBargeInVoiceMs({ VOICE_FAST_BARGE_IN_MS: '9999' })).toBe(80);
    expect(fastBargeInMinRms({})).toBe(800);
    expect(fastBargeInMinRms({ VOICE_FAST_BARGE_IN_MIN_RMS: '5' })).toBe(800);
    expect(fastBargeInConfirmMs({})).toBe(500);
    expect(fastBargeInConfirmMs({ VOICE_FAST_BARGE_IN_CONFIRM_MS: '100' })).toBe(500);
  });
});

describe('déclenchement', () => {
  it('met la lecture en pause après 80 ms de voix continue pendant que l’agent parle', () => {
    const { session, mgr, pause } = setup();
    feed(session, mgr, LOUD, 3);
    expect(pause).not.toHaveBeenCalled();
    feed(session, mgr, LOUD, 1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('ne se redéclenche pas pendant la pause', () => {
    const { session, mgr, pause } = setup();
    feed(session, mgr, LOUD, 12);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('une trame faible remet le compte à zéro (un pic isolé n’est pas de la voix)', () => {
    const { session, mgr, pause } = setup();
    feed(session, mgr, LOUD, 3);
    feed(session, mgr, QUIET, 1);
    feed(session, mgr, LOUD, 3);
    expect(pause).not.toHaveBeenCalled();
  });

  it('ne fait rien quand l’agent ne parle pas, ou sans contexte pouvant se mettre en pause', () => {
    const idle = setup({ state: 'LISTENING' } as Partial<CallSession>);
    feed(idle.session, idle.mgr, LOUD, 10);
    expect(idle.pause).not.toHaveBeenCalled();
    const silentAgent = setup({ agentAudioActive: false });
    feed(silentAgent.session, silentAgent.mgr, LOUD, 10);
    expect(silentAgent.pause).not.toHaveBeenCalled();
    const noContext = setup({ ttsContext: { cancel: vi.fn() } } as Partial<CallSession>);
    feed(noContext.session, noContext.mgr, LOUD, 10);
    expect(noContext.session.fastBargeIn?.paused).toBe(false);
  });

  it('ne fait rien quand la coupure rapide est désactivée', () => {
    vi.stubEnv('VOICE_FAST_BARGE_IN_MS', '0');
    const { session, mgr, pause } = setup();
    feed(session, mgr, LOUD, 10);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('confirmation', () => {
  it('reprend la lecture si l’appelant s’est tu : faux déclenchement', () => {
    const { session, mgr, pause, resume } = setup();
    session.callerVoice = { noiseFloor: 0, voiceRun: 0, lastVoiceAt: Date.now() - 2_000 };
    feed(session, mgr, LOUD, 4);
    expect(pause).toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(mgr.handleBargeIn).not.toHaveBeenCalled();
    expect(session.fastBargeIn?.paused).toBe(false);
  });

  it('coupe pour de bon si l’appelant parle encore à l’échéance', () => {
    const { session, mgr, resume } = setup();
    feed(session, mgr, LOUD, 4);
    session.callerVoice = { noiseFloor: 0, voiceRun: 2, lastVoiceAt: Date.now() + 450 };
    vi.advanceTimersByTime(501);
    expect(mgr.handleBargeIn).toHaveBeenCalledWith(session);
    expect(session.sttAfterBargeIn).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it('laisse faire un barge-in par transcription survenu entre-temps', () => {
    const { session, mgr, resume } = setup();
    feed(session, mgr, LOUD, 4);
    session.state = 'LISTENING';
    clearFastBargeIn(session);
    vi.advanceTimersByTime(1_000);
    expect(mgr.handleBargeIn).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
