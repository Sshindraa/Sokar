import { describe, it, expect } from 'vitest';
import { collectGuards } from '../call-report/guards';
import type { LogTurn } from '../call-report/log-events';

const turn = (overrides: Partial<LogTurn> = {}): LogTurn => ({
  turnId: 't1',
  startedAtMs: 0,
  finals: [],
  finalizes: [],
  droppedPhrases: [],
  echoEvents: [],
  outputs: [],
  decisions: [],
  interruptions: [],
  ...overrides,
});

describe('collectGuards', () => {
  it('relève une phrase retenue par le garde-fou, avec son texte', () => {
    const guards = collectGuards([
      turn({
        droppedPhrases: [
          { text: 'Parfait. Pour combien ?', reason: 'time_given_without_party_size', atMs: 1 },
        ],
      }),
    ]);
    expect(guards).toEqual([
      expect.objectContaining({
        type: 'phrase_dropped',
        turnId: 't1',
        text: 'Parfait. Pour combien ?',
        detail: 'time_given_without_party_size',
      }),
    ]);
  });

  it('relève une relecture de nom refusée', () => {
    const guards = collectGuards([
      turn({
        decisions: [{ pass: 1, actionDecision: 'spelled_name_mismatch', atMs: 1 }],
        outputs: [{ say: 'Je répète : H, huey.', atMs: 0 }],
      }),
    ]);
    expect(guards[0]).toMatchObject({
      type: 'spelled_name_mismatch',
      text: 'Je répète : H, huey.',
    });
  });

  it('relève une action refusée avec sa raison, mais pas une action autorisée', () => {
    const guards = collectGuards([
      turn({
        decisions: [
          { pass: 1, actionDecision: 'allowed', atMs: 1 },
          { pass: 2, actionDecision: 'recap_not_heard', atMs: 2 },
        ],
      }),
    ]);
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({ type: 'action_refused', detail: 'recap_not_heard' });
  });

  it("relève les mots que le filtre d'écho a retirés de la parole de l'appelant", () => {
    const guards = collectGuards([
      turn({
        echoEvents: [
          { type: 'echo_prefix_stripped', before: "c'est parfait", after: 'parfait', atMs: 1 },
        ],
      }),
    ]);
    expect(guards[0]).toMatchObject({
      type: 'echo_stripped',
      text: "c'est parfait → parfait",
    });
  });

  it("ne relève pas un écho épargné (le filtre n'a rien retiré)", () => {
    expect(
      collectGuards([turn({ echoEvents: [{ type: 'echo_spared', kept: 'oui', atMs: 1 }] })]),
    ).toEqual([]);
  });

  it('ne renvoie rien pour un tour sans garde-fou', () => {
    expect(
      collectGuards([turn({ decisions: [{ pass: 1, actionDecision: 'allowed', atMs: 1 }] })]),
    ).toEqual([]);
  });
});
