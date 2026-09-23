/**
 * Banc d'évaluation vocal : joue chaque scénario avec un LLM appelant contre
 * le vrai pipeline de l'agent (Groq réel), la base et Telnyx étant simulés.
 *
 *   pnpm --filter @sokar/api eval:voice
 *
 * Variables : GROQ_API_KEY (obligatoire), VOICE_EVAL_FILTER (sous-chaîne
 * d'identifiant ou de catégorie), VOICE_EVAL_MIN_PASS_RATE (défaut 0.95),
 * VOICE_EVAL_CALLER_MODEL, VOICE_EVAL_JUDGE_MODEL, VOICE_EVAL_OUTPUT_DIR.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { voiceConfig } from '../../../env';
import { readEvalLlmConfig } from './eval-llm';
import { installEvalFakes, type EvalFakesState } from './fakes';
import { createScenarioRuntime, runScenario, type ScenarioReport } from './run-scenario';
import { loadScenarios, RESTAURANT_PRESETS } from './scenario';

const config = readEvalLlmConfig();
const filter = process.env.VOICE_EVAL_FILTER?.trim();
const minPassRate = Number(process.env.VOICE_EVAL_MIN_PASS_RATE ?? '0.95');
const outputDir = path.resolve(process.env.VOICE_EVAL_OUTPUT_DIR ?? 'eval-results');
const scenarios = loadScenarios().filter(
  (scenario) => !filter || scenario.id.includes(filter) || scenario.category.includes(filter),
);

const fakes: EvalFakesState = { runtime: null, restaurantId: '' };
const reports: ScenarioReport[] = [];

beforeAll(() => {
  if (!config) return;
  voiceConfig.GROQ_API_KEY = config.apiKey;
  // Réponses toujours en direct : ni cache TTS ni options expérimentales.
  delete process.env.VOICE_TURN_PLAN_SHADOW_ENABLED;
  delete process.env.SPECULATIVE_LLM_ENABLED;

  installEvalFakes(fakes);
});

afterAll(() => {
  if (!config || reports.length === 0) return;
  mkdirSync(outputDir, { recursive: true });
  const passed = reports.filter((report) => report.passed).length;
  const critical = reports.filter((report) => report.critical);
  const scored = reports.filter((report) => (report.naturalness?.score ?? 0) > 0);
  const naturalness = scored.length
    ? scored.reduce((sum, report) => sum + (report.naturalness?.score ?? 0), 0) / scored.length
    : 0;
  const summary = {
    total: reports.length,
    passed,
    passRate: passed / reports.length,
    criticalErrors: critical.length,
    naturalness: Number(naturalness.toFixed(2)),
    minPassRate,
    callerModel: config.callerModel,
    judgeModel: config.judgeModel,
  };
  writeFileSync(
    path.join(outputDir, 'voice-eval-report.json'),
    JSON.stringify({ summary, reports }, null, 2),
  );

  const byCategory = new Map<string, { total: number; passed: number }>();
  for (const report of reports) {
    const entry = byCategory.get(report.category) ?? { total: 0, passed: 0 };
    entry.total++;
    if (report.passed) entry.passed++;
    byCategory.set(report.category, entry);
  }
  const failures = reports.filter((report) => !report.passed);
  const markdown = [
    '## Banc d’évaluation vocal',
    '',
    `**${passed}/${reports.length} scénarios réussis (${(summary.passRate * 100).toFixed(1)} %)** — seuil ${(minPassRate * 100).toFixed(0)} %`,
    `Erreurs critiques : **${critical.length}** · Naturel moyen : **${summary.naturalness}/5**`,
    '',
    '| Catégorie | Réussis |',
    '|---|---|',
    ...[...byCategory].map(
      ([category, entry]) => `| ${category} | ${entry.passed}/${entry.total} |`,
    ),
    '',
    ...(failures.length
      ? [
          '### Échecs',
          '',
          ...failures.map(
            (report) =>
              `- ${report.critical ? '🔴 ' : ''}\`${report.id}\` : ${report.checks
                .filter((check) => !check.passed)
                .map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ''}`)
                .join(' ; ')}`,
          ),
        ]
      : []),
  ].join('\n');
  writeFileSync(path.join(outputDir, 'voice-eval-report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  // Résumé lisible dans la sortie du job CI.
  // eslint-disable-next-line no-console
  console.log(markdown);
});

describe.skipIf(!config)('banc d’évaluation vocal', () => {
  it.each(scenarios.map((scenario) => [scenario.id, scenario] as const))(
    '%s',
    async (_id, scenario) => {
      const runtime = createScenarioRuntime(scenario);
      fakes.runtime = runtime;
      fakes.restaurantId = RESTAURANT_PRESETS[scenario.restaurant].id;
      const report = await runScenario(scenario, config!, runtime);
      reports.push(report);
      fakes.runtime = null;
      // Un scénario raté n'arrête pas le banc : le seuil global décide.
      expect(report.id).toBe(scenario.id);
    },
    300_000,
  );

  it('respecte le seuil bloquant (≥ 95 % de réussite, 0 erreur critique)', () => {
    const passed = reports.filter((report) => report.passed).length;
    const critical = reports.filter((report) => report.critical).map((report) => report.id);
    expect(critical, `erreurs critiques : ${critical.join(', ')}`).toEqual([]);
    expect(passed / Math.max(1, reports.length)).toBeGreaterThanOrEqual(minPassRate);
  });
});
