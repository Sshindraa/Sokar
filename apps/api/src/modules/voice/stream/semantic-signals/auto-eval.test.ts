import { describe, expect, it, vi } from 'vitest';
import { BEHAVIORS } from './behaviors';
import {
  computeEvalReport,
  runSemanticAutoEval,
  type LabeledEvalExample,
} from './auto-eval';
import type { SemanticScoreResult } from './types';

const behavior = BEHAVIORS[0].id;
const emptyExample = (label: boolean | 'not_observable'): LabeledEvalExample => ({
  input: [{ role: 'user', content: 'question' }],
  output: { role: 'assistant', content: 'answer' },
  labels: { [behavior]: label },
});

const score = (probability: number): SemanticScoreResult => ({
  status: 'ok',
  signals: {
    [behavior]: { present: probability, absent: 1 - probability, notObservable: 0 },
  },
  durationMs: 1,
  inputTokens: 1,
  supportsNotObservable: false,
});

function voiceTurns(count: number): Array<{
  callId: string;
  turnId: string;
  sequence: number;
  callerText: string;
  agentText: string;
}> {
  return Array.from({ length: count }, (_, index) => ({
    callId: `call-${index}`,
    turnId: `turn-${index}`,
    sequence: 0,
    callerText: `CONVERSATION_MARKER_${index}`,
    agentText: `AGENT_MARKER_${index}`,
  }));
}

describe('computeEvalReport', () => {
  it('calcule les comptes exacts, exclut not_observable et choisit le seuil le plus bas à 95 %', () => {
    const report = computeEvalReport(
      [
        emptyExample(true),
        emptyExample(true),
        emptyExample(false),
        emptyExample(false),
        emptyExample('not_observable'),
      ],
      [score(0.99), score(0.85), score(0.7), score(0.3), score(0.99)],
    );
    const atHalf = report.rows.find((row) => row.behavior === behavior && row.threshold === 0.5);
    const atEight = report.rows.find((row) => row.behavior === behavior && row.threshold === 0.8);

    expect(atHalf).toMatchObject({
      tp: 2,
      fp: 1,
      tn: 1,
      fn: 0,
      precision: 2 / 3,
      recall: 1,
      examples: 4,
      judgeNotObservable: 1,
    });
    expect(atEight).toMatchObject({
      tp: 2,
      fp: 0,
      tn: 2,
      fn: 0,
      precision: 1,
      recall: 1,
      examples: 4,
      judgeNotObservable: 1,
    });
    expect(report.bestThresholds[behavior]).toBe(0.8);
  });

  it('renvoie null si aucun seuil ne respecte la précision minimale', () => {
    const report = computeEvalReport([emptyExample(true)], [score(0.2)]);
    expect(report.bestThresholds[behavior]).toBeNull();
  });
});

describe('runSemanticAutoEval', () => {
  it('fait un no-op quand le flag est désactivé', async () => {
    const loadTurns = vi.fn();
    const result = await runSemanticAutoEval({ enabled: false, loadTurns });
    expect(result).toEqual({ status: 'disabled', turns: 0 });
    expect(loadTurns).not.toHaveBeenCalled();
  });

  it('avertit et termine normalement si la clé OpenRouter manque', async () => {
    const warn = vi.fn();
    const loadTurns = vi.fn();
    const result = await runSemanticAutoEval({
      enabled: true,
      apiKey: '',
      warn,
      loadTurns,
    });
    expect(result).toEqual({ status: 'missing_key', turns: 0 });
    expect(warn).toHaveBeenCalledOnce();
    expect(loadTurns).not.toHaveBeenCalled();
  });

  it('sous 20 tours, envoie le message info sans appeler les modèles ni créer un rapport', async () => {
    const judge = vi.fn();
    const scoreModel = vi.fn();
    const writeReport = vi.fn();
    const dispatch = vi.fn().mockResolvedValue([]);
    const result = await runSemanticAutoEval({
      enabled: true,
      apiKey: 'test-key',
      loadTurns: async (_since, limit) => {
        expect(limit).toBe(300);
        return voiceTurns(19);
      },
      judge,
      score: scoreModel,
      writeReport,
      dispatch,
    });

    expect(result).toEqual({ status: 'not_enough_data', turns: 19 });
    expect(judge).not.toHaveBeenCalled();
    expect(scoreModel).not.toHaveBeenCalled();
    expect(writeReport).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: "Pas assez d'appels de test (19 tours)",
      }),
    );
  });

  it('publie uniquement des agrégats, sans transcription ni reasoning', async () => {
    const allLabels = Object.fromEntries(BEHAVIORS.map(({ id }) => [id, false]));
    const dispatch = vi.fn().mockResolvedValue([]);
    const writeReport = vi.fn().mockResolvedValue(undefined);
    let activeJudges = 0;
    let maxActiveJudges = 0;
    let activeJevCalls = 0;
    let maxActiveJevCalls = 0;
    let query: { since: Date; limit: number } | undefined;
    const judge = vi.fn().mockImplementation(async () => {
      activeJudges++;
      maxActiveJudges = Math.max(maxActiveJudges, activeJudges);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeJudges--;
      return { status: 'ok', output: { reasoning: 'PRIVATE_REASONING_MARKER', labels: allLabels } };
    });
    const scoreModel = vi.fn().mockImplementation(async () => {
      activeJevCalls++;
      maxActiveJevCalls = Math.max(maxActiveJevCalls, activeJevCalls);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeJevCalls--;
      return {
        status: 'ok',
        signals: Object.fromEntries(
          BEHAVIORS.map(({ id }) => [id, { present: 0.1, absent: 0.9, notObservable: 0 }]),
        ),
        durationMs: 1,
        inputTokens: 1,
        supportsNotObservable: false,
      };
    });

    const result = await runSemanticAutoEval({
      enabled: true,
      apiKey: 'test-key',
      now: () => new Date('2026-09-28T04:00:00.000Z'),
      loadTurns: async (since, limit) => {
        query = { since, limit };
        return voiceTurns(20);
      },
      judge,
      score: scoreModel,
      dispatch,
      writeReport,
    });

    expect(result.status).toBe('completed');
    expect(judge).toHaveBeenCalledTimes(20);
    expect(scoreModel).toHaveBeenCalledTimes(20);
    expect(query).toEqual({ since: new Date('2026-09-21T04:00:00.000Z'), limit: 300 });
    expect(maxActiveJudges).toBeLessThanOrEqual(4);
    expect(maxActiveJevCalls).toBeLessThanOrEqual(4);
    const report = writeReport.mock.calls[0][0] as object;
    const alert = dispatch.mock.calls[0][0] as { summary: string; detail: string };
    expect(JSON.stringify(report)).not.toContain('CONVERSATION_MARKER');
    expect(JSON.stringify(report)).not.toContain('PRIVATE_REASONING_MARKER');
    expect(alert.summary + alert.detail).not.toContain('CONVERSATION_MARKER');
    expect(alert.summary + alert.detail).not.toContain('PRIVATE_REASONING_MARKER');
    expect(alert.summary).toContain('20 tours');
  });
});
