import { describe, it, expect } from 'vitest';
import { rankIssues, oneLineSummary } from '../call-report/summary';
import type { EarsReport, MouthDivergence, SilenceReport } from '../call-report/types';

const mouth = (overrides: Partial<MouthDivergence> = {}): MouthDivergence => ({
  kind: 'isolated_letters',
  severity: 'high',
  agreement: 'engine_differs',
  differing: ['nova'],
  strong: false,
  inSpelling: false,
  live: 'deux s et deux m',
  engines: { nova: 'deux secondes et deux mètres' },
  liveStart: 0,
  liveEnd: 5,
  turnId: 't7',
  atSec: 45,
  cutByInterruption: false,
  ...overrides,
});

const ears = (overrides: Partial<EarsReport> = {}): EarsReport => ({
  duringInterruption: false,
  kind: 'number',
  severity: 'high',
  agreement: 'engines_agree_against_live',
  differing: ['nova', 'whisper'],
  strong: false,
  inSpelling: false,
  live: 'midi 30',
  engines: { nova: 'midi 35', whisper: 'midi 35' },
  liveStart: 0,
  liveEnd: 2,
  turnId: 't3',
  atSec: 20,
  ...overrides,
});

const silence = (overrides: Partial<SilenceReport> = {}): SilenceReport => ({
  startSec: 30,
  endSec: 33,
  durationSec: 3,
  owner: 'agent_owed',
  turnId: 't4',
  cause: 'model_latency',
  detail: '2400 ms',
  ...overrides,
});

const parts = (overrides = {}) => ({
  mouth: [],
  ears: [],
  silences: [],
  unfinished: [],
  overlaps: [],
  interruptions: [],
  guards: [],
  splitSpellings: [],
  identicalRespellings: [],
  outcome: { result: 'RESERVED', abandoned: false, lastExchanges: [] },
  ...overrides,
});

describe('rankIssues', () => {
  it("met l'écart de prononciation avant tout le reste", () => {
    const issues = rankIssues(parts({ mouth: [mouth()], ears: [ears()], silences: [silence()] }));
    expect(issues[0].kind).toBe('mouth_isolated_letters');
    expect(issues[0].title).toContain('deux secondes');
  });

  it('ne compte pas comme faute de prononciation un texte coupé par une interruption', () => {
    expect(rankIssues(parts({ mouth: [mouth({ cutByInterruption: true })] }))).toEqual([]);
  });

  it('classe un silence suivi du verdict « inachevé » sans reprise au-dessus des autres silences', () => {
    const issues = rankIssues(
      parts({
        silences: [
          silence({ turnId: 'a', durationSec: 3.4, cause: 'model_latency' }),
          silence({ turnId: 'b', durationSec: 2.98, cause: 'judge_incomplete' }),
        ],
        unfinished: [
          {
            turnId: 'b',
            callerText: 'quatre',
            callerEndSec: 9,
            callerResumed: false,
            waitedSec: 2.98,
          },
        ],
      }),
    );
    expect(issues[0]).toMatchObject({ kind: 'silence_false_unfinished', turnId: 'b' });
    expect(issues[1]).toMatchObject({ kind: 'silence_long', turnId: 'a' });
  });

  it("ne retient pas un silence de l'appelant ni un silence court", () => {
    expect(
      rankIssues(
        parts({ silences: [silence({ owner: 'caller_owed' }), silence({ durationSec: 1.6 })] }),
      ).map((issue) => issue.kind),
    ).toEqual(['silence_long']);
  });

  it("signale une divergence des oreilles sur un nombre, et l'abandon", () => {
    const issues = rankIssues(
      parts({
        ears: [ears()],
        outcome: {
          result: 'INFO',
          abandoned: true,
          lastExchanges: [{ callerText: '7', agentText: 'C’est à quel nom ?' }],
        },
      }),
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['ears_live_wrong', 'abandoned']);
  });

  it('ne garde pas les écarts de gravité basse', () => {
    expect(rankIssues(parts({ ears: [ears({ kind: 'word', severity: 'low' })] }))).toEqual([]);
  });
});

describe("erreur d'oreille systématique", () => {
  it('classe une ré-épellation identique après relecture au-dessus de la compréhension, sous la prononciation', () => {
    const issues = rankIssues(
      parts({
        mouth: [mouth()],
        ears: [ears()],
        identicalRespellings: [
          {
            letters: ['a', '2', 's', 'a', 'm'],
            readbackTurnId: 't6',
            readbackText: 'Je note A, double A, S, A, M. C’est bien ça ?',
            firstTurnIds: ['t6'],
            secondTurnIds: ['t12'],
          },
        ],
      }),
    );
    expect(issues.map((issue) => issue.kind).slice(0, 3)).toEqual([
      'mouth_isolated_letters',
      'systematic_ear_error',
      'ears_live_wrong',
    ]);
    expect(issues[1].title).toContain('a 2 s a m');
  });
});

describe('lettre entendue par le direct seulement', () => {
  it("dit que aucune oreille après coup n'a entendu la lettre, au lieu d'afficher un texte vide", () => {
    const [issue] = rankIssues(
      parts({
        ears: [
          ears({
            live: 'a',
            kind: 'isolated_letters',
            engines: { nova: '', whisper: '' },
            differing: ['nova', 'whisper'],
          }),
        ],
      }),
    );
    expect(issue.title).toContain('rien');
    expect(issue.title).not.toContain('« »');
  });

  it("signale que l'écart tombe pendant une interruption", () => {
    const [issue] = rankIssues(parts({ ears: [ears({ duringInterruption: true })] }));
    expect(issue.evidence).toContain('interruption');
  });
});

describe('titres longs', () => {
  it('raccourcit les extraits très longs dans le titre, le JSON garde le texte entier', () => {
    const long = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ');
    const [issue] = rankIssues(
      parts({ ears: [ears({ live: long, engines: { nova: long, whisper: 'autre' } })] }),
    );
    expect(issue.title.length).toBeLessThan(260);
    expect(issue.title).toContain('…');
  });
});

describe('oneLineSummary', () => {
  it('numérote les trois problèmes les plus graves', () => {
    const issues = rankIssues(parts({ mouth: [mouth()], ears: [ears()], silences: [silence()] }));
    const line = oneLineSummary(issues);
    expect(line.startsWith('1) ')).toBe(true);
    expect(line).toContain('2) ');
    expect(line).toContain('3) ');
  });

  it("dit qu'aucun problème n'a été détecté", () => {
    expect(oneLineSummary([])).toBe('Aucun problème détecté.');
  });
});
