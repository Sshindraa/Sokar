/**
 * Exporte des tours d'appels de test à annoter pour l'évaluation des signaux
 * sémantiques, et génère la page d'annotation autonome qui va avec.
 *
 * Source : `voice_debug_turns`, écrit uniquement pour les restaurants de
 * VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS (appels de test, 14 jours). Aucun appel
 * de restaurant client n'y figure. Téléphones et emails sont masqués.
 *
 *   pnpm --filter @sokar/api semantic:annotation-export -- [--days 14] [--limit 400]
 *     [--history 6] [--no-prioritize] [--out scratch/semantic-annotation]
 *
 * Avec la priorisation (défaut, nécessite OPENROUTER_API_KEY), chaque tour est
 * noté par Jev et les tours les plus incertains passent en tête. Les scores ne
 * sont pas écrits dans l'export, pour ne pas orienter l'annotation.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../src/shared/db/client';
import {
  BEHAVIORS,
  BEHAVIOR_SET_VERSION,
} from '../src/modules/voice/stream/semantic-signals/behaviors';
import { buildEvalDecisionRequest } from '../src/modules/voice/stream/semantic-signals/eval-request';
import { scoreDecisions } from '../src/modules/voice/stream/semantic-signals/openrouter-client';
import {
  buildAnnotationItems,
  type AnnotationItem,
} from '../src/modules/voice/stream/semantic-signals/annotation';
import { renderAnnotationPage } from '../src/modules/voice/stream/semantic-signals/annotation-page';

const DEFAULT_MODEL = 'typesafe/jev-1.13-20260917';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
/** Actions sensibles : un doute sur ces comportements coûte le plus cher. */
const SENSITIVE_BEHAVIORS = new Set([
  'explicitly_confirms_proposal',
  'rejects_proposal',
  'explicitly_requests_transfer',
  'explicitly_requests_message',
  'explicitly_requests_cancellation',
  'explicitly_requests_gift_card_purchase',
]);

interface Options {
  days: number;
  limit: number;
  history: number;
  prioritize: boolean;
  out: string;
}

function parseOptions(argv: string[]): Options {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: semantic-annotation-export.ts [--days 14] [--limit 400] [--history 6] [--no-prioritize] [--out dir]\n',
    );
    process.exit(0);
  }
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const integer = (flag: string, fallback: number, min: number, max: number) => {
    const raw = value(flag);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
      throw new Error(`${flag} doit être un entier entre ${min} et ${max} (reçu : ${raw})`);
    return parsed;
  };
  return {
    days: integer('--days', 14, 1, 30),
    limit: integer('--limit', 400, 1, 5000),
    history: integer('--history', 6, 1, 30),
    prioritize: !argv.includes('--no-prioritize'),
    out: value('--out') ?? 'scratch/semantic-annotation',
  };
}

/** Plus un score est proche de 0,5, plus Jev doute ; les actions sensibles comptent double. */
async function prioritize(items: AnnotationItem[]): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY est requis (ou passez --no-prioritize)');
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL;
  const model = process.env.VOICE_SEMANTIC_SIGNALS_MODEL ?? DEFAULT_MODEL;
  const statuses: Record<string, number> = {};
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        const result = await scoreDecisions(buildEvalDecisionRequest(item, model), {
          apiKey,
          baseUrl,
          signal: AbortSignal.timeout(15_000),
        });
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
        if (result.status !== 'ok') continue;
        let priority = 0;
        for (const [id, score] of Object.entries(result.signals)) {
          if (!score) continue;
          const doubt = 1 - Math.abs(score.present - 0.5) * 2;
          priority += SENSITIVE_BEHAVIORS.has(id) ? doubt * 2 : doubt;
          // Une action sensible détectée mérite une vérification humaine même si Jev est sûr.
          if (SENSITIVE_BEHAVIORS.has(id) && score.present >= 0.5) priority += 1;
        }
        item.priority = Math.round(priority * 1000) / 1000;
      }
    }),
  );
  process.stdout.write(`priorisation Jev : ${JSON.stringify(statuses)}\n`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const turns = await db.voiceDebugTurn.findMany({
    where: { createdAt: { gte: since } },
    select: { callId: true, turnId: true, sequence: true, callerText: true, agentText: true },
    orderBy: [{ callId: 'asc' }, { sequence: 'asc' }],
  });
  const items = buildAnnotationItems(turns, options.history);
  process.stdout.write(`${turns.length} tours lus, ${items.length} exportables\n`);
  if (items.length === 0) {
    process.stderr.write(
      'Aucun tour exportable : passez des appels de test sur un restaurant de debug.\n',
    );
    process.exitCode = 1;
    return;
  }
  if (options.prioritize) await prioritize(items);
  items.sort((a, b) => b.priority - a.priority);
  const selected = items.slice(0, options.limit);

  const outputDir = path.resolve(options.out);
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const jsonl = path.join(outputDir, `to-annotate-${stamp}.jsonl`);
  const html = path.join(outputDir, `annotate-${stamp}.html`);
  await writeFile(
    jsonl,
    `${selected.map(({ id, input, output }) => JSON.stringify({ id, input, output, labels: {} })).join('\n')}\n`,
  );
  await writeFile(
    html,
    renderAnnotationPage({
      items: selected,
      behaviors: BEHAVIORS.map(({ id, instructions, present, absent }) => ({
        id,
        instructions,
        present,
        absent,
      })),
      behaviorSetVersion: BEHAVIOR_SET_VERSION,
    }),
  );
  process.stdout.write(`${selected.length} tours sélectionnés\n${jsonl}\n${html}\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Export failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
