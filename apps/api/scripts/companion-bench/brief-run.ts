/**
 * Banc du résumé « Ce soir » : chaque scénario de brief-scenarios.ts part N fois au modèle de
 * production, sans outil, sur la base locale de DEMO_RESTAURANT_ID. Le contrôle d'ancrage de la
 * production n'est pas appliqué ici : le banc note la réponse brute, selon les critères figés.
 *
 * Usage (depuis apps/api) : pnpm exec tsx scripts/companion-bench/brief-run.ts --trials 3
 * Options : --only 1,3 (scénarios). Résultats dans results/, ignoré par git.
 */
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { env } from '../../src/env';
import { db } from '../../src/shared/db/client';
import { briefFacts, modelBrief } from '../../src/modules/companion/brief';
import { computeTonight } from '../../src/modules/companion/tonight';
import { BRIEF_CRITERIA, BRIEF_SCENARIOS, scoreBrief, sentenceWords } from './brief-scenarios';

// Même liste que run.ts : le banc ne tourne que sur une base locale.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const RESULTS_DIR = path.join(__dirname, 'results');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function isLocalDatabase(rawUrl: string | undefined): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(rawUrl ?? '').hostname);
  } catch {
    return false;
  }
}

interface Run {
  scenario: number;
  trial: number;
  reply: string;
  expected: number[];
  score: ReturnType<typeof scoreBrief>;
  model: string;
  latency_ms: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function main() {
  if (process.env.NODE_ENV === 'production' || !isLocalDatabase(process.env.DATABASE_URL)) {
    throw new Error('banc refusé : NODE_ENV=production ou DATABASE_URL hors localhost.');
  }
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY absente (apps/api/.env).');
  const restaurantId = process.env.DEMO_RESTAURANT_ID;
  if (!restaurantId) throw new Error('DEMO_RESTAURANT_ID absent (apps/api/.env).');

  const trials = Number(option('--trials') ?? 1);
  const only = option('--only')?.split(',').map(Number);
  const scenarios = BRIEF_SCENARIOS.filter((scenario) => !only || only.includes(scenario.n));
  const runs: Run[] = [];

  for (const scenario of scenarios) {
    const expected = await scenario.expected(restaurantId);
    const names = await scenario.names(restaurantId);
    for (let trial = 1; trial <= trials; trial++) {
      const card = await computeTonight(restaurantId, new Date(scenario.now));
      const facts = await briefFacts(restaurantId, card, { recovery: scenario.recovery });
      const answer = await modelBrief(facts, 'fr');
      const score = scoreBrief({ reply: answer.text, facts, expected, names });
      runs.push({
        scenario: scenario.n,
        trial,
        reply: answer.text,
        expected,
        score,
        model: answer.model,
        latency_ms: answer.latencyMs,
        input_tokens: answer.inputTokens,
        cached_input_tokens: answer.cachedInputTokens,
        output_tokens: answer.outputTokens,
      });
      // eslint-disable-next-line no-console -- banc : bilan lu dans le terminal
      console.log(
        `[${scenario.n}.${trial}] ancré ${score.anchored}, ${score.sentences} phrases, point ${score.point}, noms ${score.names.length} : ${answer.text}`,
      );
    }
  }

  const count = (test: (run: Run) => boolean) => `${runs.filter(test).length}/${runs.length}`;
  const summary = {
    anchored: count((run) => run.score.anchored),
    withinSentences: count((run) => run.score.withinSentences),
    withinWords: count((run) => run.score.withinWords),
    wordsPerSentenceMedian: median(runs.flatMap((run) => sentenceWords(run.reply))),
    wordsPerSentenceMax: Math.max(...runs.flatMap((run) => sentenceWords(run.reply))),
    point: count((run) => run.score.point),
    noName: count((run) => run.score.names.length <= BRIEF_CRITERIA.maxNames),
    latencyMedianMs: median(runs.map((run) => run.latency_ms as number)),
    latencyMaxMs: Math.max(...runs.map((run) => run.latency_ms as number)),
    inputTokens: runs.reduce((sum, run) => sum + run.input_tokens, 0),
    cachedInputTokens: runs.reduce((sum, run) => sum + run.cached_input_tokens, 0),
    outputTokens: runs.reduce((sum, run) => sum + run.output_tokens, 0),
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(
    RESULTS_DIR,
    `brief-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(file, JSON.stringify({ criteria: BRIEF_CRITERIA, summary, runs }, null, 2) + '\n');
  // eslint-disable-next-line no-console -- banc : bilan lu dans le terminal
  console.log(JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console -- banc : bilan lu dans le terminal
  console.log(`Fichier : ${file}`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console -- banc : bilan lu dans le terminal
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    // Redis garde la boucle d’événements ouverte : le banc se termine ici.
    process.exit(process.exitCode ?? 0);
  });
