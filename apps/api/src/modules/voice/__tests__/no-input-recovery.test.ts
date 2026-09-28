import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stream/tts-handler', () => ({ speakTtsStreamed: vi.fn(async () => undefined) }));

import { speakTtsStreamed } from '../stream/tts-handler';
import {
  armSilenceRecovery,
  cancelNoInputRecovery,
  lastAgentQuestion,
  MAX_RECOVERIES_PER_CALL,
  noInputTimeoutMs,
  scheduleUnheardRecovery,
  UNHEARD_GRACE_MS,
} from '../stream/no-input-recovery';
import type { CallSession } from '../stream/types';

const RESTAURANT = 'resto-debug';

function makeSession(overrides: Partial<CallSession> = {}): CallSession {
  return {
    callControlId: 'call-test',
    restaurantId: RESTAURANT,
    state: 'LISTENING',
    ended: false,
    history: [
      { role: 'user', content: 'à 18 heures' },
      { role: 'assistant', content: 'Oui, 18 heures ça marche. Vous serez combien ?' },
    ],
    sttLastSpeechStartedAt: Date.now(),
    ...overrides,
  } as unknown as CallSession;
}

function makeManager() {
  return {
    transition: vi.fn((session: CallSession, state: CallSession['state']) => {
      session.state = state;
      return true;
    }),
  };
}

describe('no-input recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VOICE_NO_INPUT_RECOVERY_RESTAURANT_IDS', RESTAURANT);
    vi.mocked(speakTtsStreamed).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("reprend la dernière question de l'agent", () => {
    expect(lastAgentQuestion(makeSession())).toBe('Vous serez combien ?');
    expect(
      lastAgentQuestion(
        makeSession({ history: [{ role: 'assistant', content: 'C’est noté, à demain.' }] }),
      ),
    ).toBeNull();
  });

  it('relance quand une parole est détectée sans aucun mot reconnu', async () => {
    const session = makeSession();
    const mgr = makeManager();

    scheduleUnheardRecovery(session, mgr);
    await vi.advanceTimersByTimeAsync(UNHEARD_GRACE_MS);

    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      "Pardon, je n'ai pas bien entendu. Vous serez combien ?",
    );
    expect(session.history.at(-1)).toEqual({
      role: 'assistant',
      content: "Pardon, je n'ai pas bien entendu. Vous serez combien ?",
    });
    expect(session.state).toBe('LISTENING');
  });

  it("n'a pas de relance si un mot arrive pendant le délai de grâce", async () => {
    const session = makeSession();
    scheduleUnheardRecovery(session, makeManager());
    cancelNoInputRecovery(session);
    await vi.advanceTimersByTimeAsync(UNHEARD_GRACE_MS * 2);
    expect(speakTtsStreamed).not.toHaveBeenCalled();
  });

  it('ignore un speech_final vide sans parole récente (bruit de ligne)', async () => {
    const session = makeSession({ sttLastSpeechStartedAt: Date.now() - 60_000 });
    scheduleUnheardRecovery(session, makeManager());
    await vi.advanceTimersByTimeAsync(UNHEARD_GRACE_MS * 2);
    expect(speakTtsStreamed).not.toHaveBeenCalled();
  });

  it("relance après un silence, puis s'arrête au maximum par appel", async () => {
    const session = makeSession();
    const mgr = makeManager();
    for (let i = 0; i < MAX_RECOVERIES_PER_CALL + 2; i++) {
      armSilenceRecovery(session, mgr);
      await vi.advanceTimersByTimeAsync(noInputTimeoutMs());
    }
    expect(speakTtsStreamed).toHaveBeenCalledTimes(MAX_RECOVERIES_PER_CALL);
    expect(vi.mocked(speakTtsStreamed).mock.calls[0][1]).toBe(
      'Vous êtes toujours là ? Vous serez combien ?',
    );
  });

  it("ne dit rien pendant que l'agent parle, en clôture, ou hors des restaurants activés", async () => {
    for (const session of [
      makeSession({ state: 'SPEAKING' }),
      makeSession({ ending: { reason: 'test' } as unknown as CallSession['ending'] }),
      makeSession({ restaurantId: 'autre-restaurant' }),
    ]) {
      armSilenceRecovery(session, makeManager());
      scheduleUnheardRecovery(session, makeManager());
    }
    await vi.advanceTimersByTimeAsync(noInputTimeoutMs() + UNHEARD_GRACE_MS);
    expect(speakTtsStreamed).not.toHaveBeenCalled();
  });
});
