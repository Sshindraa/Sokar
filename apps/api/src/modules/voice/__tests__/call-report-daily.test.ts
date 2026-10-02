import { describe, it, expect } from 'vitest';
import { parisDayRange, renderDailySummary, summarizeReports } from '../call-report/daily-summary';
import type { CallReport } from '../call-report/types';

function report(overrides: Partial<CallReport> = {}): CallReport {
  return {
    reportVersion: 1,
    generatedAt: '2026-10-03T08:00:00.000Z',
    call: {
      id: 'aaaaaaaa-0000',
      restaurantId: 'r',
      createdAt: '2026-10-02T12:00:00.000Z',
      durationSec: 60,
      outcome: 'RESERVED',
    },
    logs: { status: 'linked', callKey: 'k' },
    tracks: {
      caller: { noiseFloorDbfs: -60, speechLevelDbfs: -25, clippedRatio: 0 },
      agent: { noiseFloorDbfs: -60, speechLevelDbfs: -25, clippedRatio: 0 },
    },
    clock: { offsetSec: 0, calibratedOnTurns: 3 },
    timeline: [],
    ears: [],
    mouth: [],
    silences: [],
    turnTaking: { unfinished: [], overlaps: [], interruptions: [], splitSpellings: [] },
    guards: [],
    counters: { noCallerVoice: 0 },
    outcome: { result: 'RESERVED', abandoned: false, lastExchanges: [] },
    summary: { oneLine: 'Aucun problème détecté.', issues: [] },
    engines: [],
    costUsd: 0.01,
    limits: [],
    ...overrides,
  };
}

const ear = (severity: 'high' | 'medium' | 'low') =>
  ({
    kind: 'number',
    severity,
    agreement: 'engines_agree_against_live',
    differing: ['nova'],
    strong: false,
    inSpelling: false,
    live: 'a',
    engines: { nova: 'b' },
    liveStart: 0,
    liveEnd: 1,
    turnId: 't',
    atSec: 1,
  }) as CallReport['ears'][number];

describe('summarizeReports', () => {
  it('compte les appels, les silences de plus de 2 s, les divergences, les écarts de prononciation et les abandons', () => {
    const summary = summarizeReports([
      report({
        silences: [
          {
            startSec: 1,
            endSec: 4,
            durationSec: 3,
            owner: 'agent_owed',
            turnId: 't',
            cause: 'model_latency',
            detail: null,
          },
          {
            startSec: 5,
            endSec: 6.8,
            durationSec: 1.8,
            owner: 'agent_owed',
            turnId: 't',
            cause: null,
            detail: null,
          },
          {
            startSec: 8,
            endSec: 12,
            durationSec: 4,
            owner: 'caller_owed',
            turnId: null,
            cause: null,
            detail: null,
          },
        ],
        ears: [ear('high'), ear('low')],
        mouth: [{ ...ear('high'), turnId: 't', atSec: 1, cutByInterruption: false }],
        outcome: { result: 'INFO', abandoned: true, lastExchanges: [] },
        costUsd: 0.02,
      }),
      report({
        call: {
          id: 'bbbbbbbb-1111',
          restaurantId: 'r',
          createdAt: '2026-10-02T13:00:00.000Z',
          durationSec: 40,
          outcome: 'RESERVED',
        },
      }),
    ]);
    expect(summary.calls).toBe(2);
    expect(summary.silencesOver2s).toBe(1);
    expect(summary.earsDivergences).toBe(1);
    expect(summary.mouthDivergences).toBe(1);
    expect(summary.abandoned).toBe(1);
    expect(summary.costUsd).toBeCloseTo(0.03, 5);
  });

  it('compte les journaux manquants pour que le résumé ne cache pas un trou', () => {
    const summary = summarizeReports([
      report({ logs: { status: 'missing', callKey: null } }),
      report(),
    ]);
    expect(summary.withoutLogs).toBe(1);
  });

  it('ne compte pas comme écart de prononciation une réplique coupée par une interruption', () => {
    const summary = summarizeReports([
      report({ mouth: [{ ...ear('high'), turnId: 't', atSec: 1, cutByInterruption: true }] }),
    ]);
    expect(summary.mouthDivergences).toBe(0);
  });
});

describe('renderDailySummary', () => {
  it('renvoie à chaque rapport par sa commande de lecture', () => {
    const markdown = renderDailySummary('2026-10-02', summarizeReports([report()]));
    expect(markdown).toContain('# Résumé des appels du 2026-10-02');
    expect(markdown).toContain('voice_call_audio.py report aaaaaaaa');
    expect(markdown).toContain('Aucun problème détecté.');
  });

  it('dit quand il n’y a aucun rapport', () => {
    expect(renderDailySummary('2026-10-02', summarizeReports([]))).toContain('Aucun rapport');
  });
});

describe('parisDayRange', () => {
  it('couvre la journée locale de Paris (été : minuit local = 22 h UTC la veille)', () => {
    const { fromMs, toMs } = parisDayRange('2026-10-02');
    expect(new Date(fromMs).toISOString()).toBe('2026-10-01T22:00:00.000Z');
    expect(new Date(toMs).toISOString()).toBe('2026-10-02T22:00:00.000Z');
  });

  it('couvre la journée locale de Paris (hiver : minuit local = 23 h UTC la veille)', () => {
    const { fromMs } = parisDayRange('2026-12-02');
    expect(new Date(fromMs).toISOString()).toBe('2026-12-01T23:00:00.000Z');
  });
});
