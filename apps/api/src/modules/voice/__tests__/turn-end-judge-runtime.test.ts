import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTurnEndJudgeMessages,
  lastAgentQuestion,
  parseTurnEndJudgeVerdict,
  startTurnEndJudge,
  turnEndJudgeTimeoutMs,
} from '../stream/structured-turn/turn-end-judge';
import { isVoiceTurnJudgeEnabled } from '../stream/feature-flags';
import type { CallSession } from '../stream/types';

const sessionWith = (history: CallSession['history']): CallSession =>
  ({ callControlId: 'call', history }) as unknown as CallSession;

const manager = (stream: (...args: unknown[]) => Promise<string>) => {
  const streamStructuredCompletion = vi.fn(stream);
  return { streamStructuredCompletion } as unknown as Parameters<typeof startTurnEndJudge>[1] & {
    streamStructuredCompletion: typeof streamStructuredCompletion;
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('juge de fin de tour : requête', () => {
  it('ne porte que la dernière question de l’agent et la parole de l’appelant', () => {
    const history = [
      { role: 'user', content: 'bonjour' },
      { role: 'assistant', content: 'Pour quel jour ?' },
      { role: 'user', content: 'demain' },
      { role: 'assistant', content: 'Vers quelle heure ?' },
    ] as CallSession['history'];
    expect(lastAgentQuestion(history)).toBe('Vers quelle heure ?');
    const messages = buildTurnEndJudgeMessages(lastAgentQuestion(history), 'je voudrais');
    expect(messages).toHaveLength(2);
    expect(String(messages[1].content)).toContain('Vers quelle heure ?');
    expect(String(messages[1].content)).toContain('je voudrais');
    expect(JSON.stringify(messages)).not.toContain('Pour quel jour');
  });

  it('lit seulement un booléen `complete`', () => {
    expect(parseTurnEndJudgeVerdict('{"complete":true}')).toBe(true);
    expect(parseTurnEndJudgeVerdict('{"complete":false}')).toBe(false);
    expect(parseTurnEndJudgeVerdict('{"complete":"oui"}')).toBeNull();
    expect(parseTurnEndJudgeVerdict('pas du json')).toBeNull();
    expect(parseTurnEndJudgeVerdict('{}')).toBeNull();
  });
});

describe('juge de fin de tour : exécution', () => {
  const history = [{ role: 'assistant', content: 'Vers quelle heure ?' }] as CallSession['history'];

  it('rend le verdict, et ne juge qu’une fois la même phrase après la même question', async () => {
    const mgr = manager(async () => '{"complete":false}');
    const session = sessionWith(history);
    expect(await startTurnEndJudge(session, mgr, 'je voudrais bien venir')).toBe(false);
    expect(await startTurnEndJudge(session, mgr, 'je voudrais bien venir')).toBe(false);
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
    expect(await startTurnEndJudge(session, mgr, 'à 20 heures')).toBe(false);
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
  });

  it('rend null sur une erreur ou une réponse invalide (repli sur turnComplete)', async () => {
    const failing = manager(async () => {
      throw new Error('LLM indisponible');
    });
    expect(await startTurnEndJudge(sessionWith(history), failing, 'trois')).toBeNull();
    const invalid = manager(async () => '{"complete":"peut-être"}');
    expect(await startTurnEndJudge(sessionWith(history), invalid, 'trois')).toBeNull();
  });

  it('rend null au délai dépassé et abandonne la requête', async () => {
    vi.stubEnv('VOICE_TURN_JUDGE_TIMEOUT_MS', '200');
    let aborted = false;
    const mgr = manager(
      (_session, _messages, _format, options) =>
        new Promise<string>((_resolve, reject) => {
          (options as { signal: AbortSignal }).signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const startedAt = Date.now();
    expect(await startTurnEndJudge(sessionWith(history), mgr, 'trois')).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(aborted).toBe(true);
  });

  it('borne le délai et ne s’active que pour les restaurants listés', () => {
    expect(turnEndJudgeTimeoutMs({})).toBe(800);
    expect(turnEndJudgeTimeoutMs({ VOICE_TURN_JUDGE_TIMEOUT_MS: '50' })).toBe(800);
    expect(turnEndJudgeTimeoutMs({ VOICE_TURN_JUDGE_TIMEOUT_MS: '500' })).toBe(500);
    expect(isVoiceTurnJudgeEnabled('r1', { VOICE_TURN_JUDGE_RESTAURANT_IDS: 'r1,r2' })).toBe(true);
    expect(isVoiceTurnJudgeEnabled('r3', { VOICE_TURN_JUDGE_RESTAURANT_IDS: 'r1,r2' })).toBe(false);
    expect(isVoiceTurnJudgeEnabled('r1', {})).toBe(false);
    expect(isVoiceTurnJudgeEnabled(undefined, { VOICE_TURN_JUDGE_RESTAURANT_IDS: 'r1' })).toBe(
      false,
    );
  });
});
