/**
 * Banc d'évaluation vocal : joue chaque scénario avec un LLM appelant contre
 * le vrai pipeline de l'agent (Groq réel), la base et Telnyx étant simulés.
 *
 *   pnpm --filter @sokar/api eval:voice
 *
 * Variables :
 * - VOICE_EVAL_GROQ_API_KEY (clé dédiée ; à défaut GROQ_API_KEY en local) ;
 * - VOICE_EVAL_TIER=pr : sous-ensemble rapide (~10 scénarios) ;
 * - VOICE_EVAL_FILTER : sous-chaîne d'identifiant ou de catégorie ;
 * - VOICE_EVAL_REPEAT : nombre de passages par scénario (calibrage) ;
 * - VOICE_EVAL_MIN_PASS_RATE : seuil de réussite bloquant, désactivé tant
 *   qu'il n'est pas calibré. Les erreurs critiques bloquent toujours ;
 * - VOICE_EVAL_NOW : date figée (défaut : un mardi, EVAL_FIXED_NOW) ;
 * - VOICE_EVAL_CALLER_MODEL, VOICE_EVAL_JUDGE_MODEL, VOICE_EVAL_OUTPUT_DIR.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { voiceConfig } from '../../../env';
import { readEvalLlmConfig } from './eval-llm';
import { installEvalFakes, type EvalFakesState } from './fakes';
import { createScenarioRuntime, runScenario, type ScenarioReport } from './run-scenario';
import { EVAL_FIXED_NOW, loadScenarios, RESTAURANT_PRESETS } from './scenario';

const config = readEvalLlmConfig();
const filter = process.env.VOICE_EVAL_FILTER?.trim();
const prTier = process.env.VOICE_EVAL_TIER === 'pr';
const repeat = Math.max(1, Math.min(10, Number(process.env.VOICE_EVAL_REPEAT ?? '1') || 1));
const minPassRateSetting = process.env.VOICE_EVAL_MIN_PASS_RATE?.trim();
const minPassRate = minPassRateSetting ? Number(minPassRateSetting) : null;
const fixedNow = new Date(process.env.VOICE_EVAL_NOW ?? EVAL_FIXED_NOW);
const outputDir = path.resolve(process.env.VOICE_EVAL_OUTPUT_DIR ?? 'eval-results');
const scenarios = loadScenarios().filter(
  (scenario) =>
    (!prTier || scenario.pr) &&
    (!filter || scenario.id.includes(filter) || scenario.category.includes(filter)),
);
const runs = scenarios.flatMap((scenario) =>
  Array.from({ length: repeat }, (_, index) => ({
    label: repeat > 1 ? `${scenario.id} #${index + 1}` : scenario.id,
    scenario,
  })),
);

const fakes: EvalFakesState = { runtime: null, restaurantId: '' };
const reports: ScenarioReport[] = [];

beforeAll(() => {
  if (!config) return;
  voiceConfig.GROQ_API_KEY = config.apiKey;
  // Date figée : le résultat ne dépend pas du jour du passage. Seule la
  // date est simulée ; les minuteries restent réelles pour le réseau.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true, now: fixedNow });
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
    tier: prTier ? 'pr' : 'full',
    repeat,
    fixedNow: fixedNow.toISOString(),
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
    `**${passed}/${reports.length} passages réussis (${(summary.passRate * 100).toFixed(1)} %)** — ${minPassRate === null ? 'seuil de réussite non bloquant (calibrage)' : `seuil ${(minPassRate * 100).toFixed(0)} %`}`,
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
  it.each(runs.map((run) => [run.label, run.scenario] as const))(
    '%s',
    async (_label, scenario) => {
      const runtime = createScenarioRuntime(scenario);
      fakes.runtime = runtime;
      fakes.restaurantId = RESTAURANT_PRESETS[scenario.restaurant].id;
      const report = await runScenario(scenario, config!, runtime, new Date());
      reports.push(report);
      fakes.runtime = null;
      // Un scénario raté n'arrête pas le banc : le seuil global décide.
      expect(report.id).toBe(scenario.id);
    },
    300_000,
  );

  it('aucune erreur critique (date, heure ou nombre faux)', () => {
    const critical = reports.filter((report) => report.critical).map((report) => report.id);
    expect(critical, `erreurs critiques : ${critical.join(', ')}`).toEqual([]);
  });

  it.skipIf(minPassRate === null)('respecte le seuil de réussite calibré', () => {
    const passed = reports.filter((report) => report.passed).length;
    expect(passed / Math.max(1, reports.length)).toBeGreaterThanOrEqual(minPassRate ?? 0);
  });
});
