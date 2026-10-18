import { describe, it, expect } from 'vitest';
import { findSilences, attributeSilenceCause, type CauseInput } from '../call-report/silences';

describe('findSilences', () => {
  it("liste le silence que l'appelant perçoit entre la fin de sa parole et la voix de l'agent", () => {
    const silences = findSilences([[1, 3]], [[5.2, 7]]);
    expect(silences).toEqual([{ startSec: 3, endSec: 5.2, durationSec: 2.2, owner: 'agent_owed' }]);
  });

  it("distingue le silence qui revient à l'appelant (l'agent a fini, l'appelant tarde)", () => {
    const silences = findSilences([[10, 11]], [[5, 7]]);
    expect(silences).toEqual([{ startSec: 7, endSec: 10, durationSec: 3, owner: 'caller_owed' }]);
  });

  it('ignore un silence de moins de 1,5 s', () => {
    expect(findSilences([[1, 3]], [[4.4, 6]])).toEqual([]);
  });

  it("ne compte pas de silence quand l'agent parle déjà avant la fin de l'appelant", () => {
    expect(findSilences([[1, 5]], [[4, 8]])).toEqual([]);
  });

  it("suit plusieurs échanges, dans l'ordre, et nomme qui était attendu", () => {
    const silences = findSilences(
      [
        [1, 3],
        [9, 10],
      ],
      [
        [6, 8],
        [13, 14],
      ],
    );
    expect(silences.map((s) => [s.owner, s.startSec, s.endSec])).toEqual([
      ['agent_owed', 3, 6],
      ['agent_owed', 10, 13],
    ]);
  });

  it("repère une pause de l'agent au milieu de sa propre réponse", () => {
    const silences = findSilences(
      [],
      [
        [1, 2],
        [4, 5],
      ],
    );
    expect(silences[0]).toMatchObject({ owner: 'agent_pause', durationSec: 2 });
  });

  it("repère une pause de l'appelant au milieu de sa propre prise de parole", () => {
    const silences = findSilences(
      [
        [1, 2],
        [4, 5],
      ],
      [],
    );
    expect(silences[0]).toMatchObject({ owner: 'caller_pause' });
  });
});

const base = (overrides: Partial<CauseInput> = {}): CauseInput => ({
  callerText: 'bonjour je voudrais une table',
  decisions: [{ pass: 1, actionDecision: 'allowed' }],
  droppedPhrases: 0,
  finalizeTriggers: [],
  ...overrides,
});

describe('attributeSilenceCause', () => {
  it('attribue le silence au verdict « inachevé » du juge', () => {
    const result = attributeSilenceCause(
      base({ decisions: [{ pass: 1, judge: 'incomplete', actionDecision: 'allowed' }] }),
    );
    expect(result.cause).toBe('judge_incomplete');
  });

  it("reconnaît une pause d'épellation quand l'appelant finit sur des lettres isolées", () => {
    expect(attributeSilenceCause(base({ callerText: 'mon nom est h o u e' })).cause).toBe(
      'spelling_pause',
    );
  });

  it('reconnaît un second passage', () => {
    const result = attributeSilenceCause(
      base({
        decisions: [
          { pass: 1, actionDecision: 'allowed' },
          { pass: 2, actionDecision: 'allowed' },
        ],
      }),
    );
    expect(result.cause).toBe('second_pass');
  });

  it('reconnaît un garde-fou (phrase retenue)', () => {
    expect(attributeSilenceCause(base({ droppedPhrases: 1 })).cause).toBe('guard');
  });

  it('reconnaît un garde-fou (action refusée)', () => {
    const result = attributeSilenceCause(
      base({ decisions: [{ pass: 1, actionDecision: 'spelled_name_mismatch' }] }),
    );
    expect(result.cause).toBe('guard');
    expect(result.detail).toContain('spelled_name_mismatch');
  });

  it('retient le composant le plus long quand aucune règle ne s’applique', () => {
    expect(
      attributeSilenceCause(
        base({ endOfSpeechToSttFinalMs: 1700, holdMs: 0, llmFirstPhraseMs: 600 }),
      ).cause,
    ).toBe('stt_endpointing');
    expect(
      attributeSilenceCause(
        base({ endOfSpeechToSttFinalMs: 300, llmFirstPhraseMs: 2400, ttsFirstByteMs: 200 }),
      ).cause,
    ).toBe('model_latency');
    expect(
      attributeSilenceCause(
        base({ endOfSpeechToSttFinalMs: 300, llmFirstPhraseMs: 400, ttsFirstByteMs: 1500 }),
      ).cause,
    ).toBe('tts_latency');
  });

  it('dit « stall » quand la fin de tour a attendu la détection de blocage', () => {
    const result = attributeSilenceCause(
      base({ finalizeTriggers: ['stall'], endOfSpeechToSttFinalMs: 1700 }),
    );
    expect(result.cause).toBe('stt_endpointing');
    expect(result.detail).toContain('stall');
  });

  it('avoue ne pas savoir quand les journaux manquent', () => {
    expect(attributeSilenceCause(null).cause).toBe('unknown_no_logs');
  });

  it('avoue ne pas savoir quand rien ne se démarque', () => {
    expect(attributeSilenceCause(base()).cause).toBe('unknown');
  });
});
