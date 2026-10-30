/**
 * Banc de questions du Companion : chaque question part 3 fois dans answerCompanion, avec la vraie
 * clé OpenRouter, directement (ni HTTP ni plafond), sur la base locale de DEMO_RESTAURANT_ID.
 *
 * Usage (depuis apps/api) : npx tsx scripts/companion-bench/run.ts
 * Les chiffres attendus se recalculent au moment du test avec les fonctions que les outils appellent.
 * Questions 1 à 11 et 17 à 19 : outil attendu dans les sources, puis valeur attendue dans la réponse,
 * chaque critère noté à part. Questions 12 à 16 : à relire à la main, réponses brutes dans results/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../src/env';
import { db } from '../../src/shared/db/client';
import { answerCompanion } from '../../src/modules/companion/companion.service';
import { computeRoi } from '../../src/modules/analytics/roi.service';
import { computeCallStats } from '../../src/modules/calls/call-stats';
import {
  computeDashboardStats,
  computeEmptySlots,
  computeNoShowStats,
} from '../../src/modules/dashboard/dashboard.routes';

// Même liste que packages/database/prisma/seed-demo-guard.ts.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const RESULTS_DIR = path.join(__dirname, 'results');
const DAY_NAMES: Record<string, string> = {
  dim: 'dimanche',
  lun: 'lundi',
  mar: 'mardi',
  mer: 'mercredi',
  jeu: 'jeudi',
  ven: 'vendredi',
  sam: 'samedi',
};
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// alt : second nombre accepté. rates : seuls pourcentages permis, ceux que renvoie un outil.
type Expected =
  | {
      kind: 'count' | 'amount' | 'rate';
      value: number;
      unit?: string;
      alt?: number;
      rates?: number[];
    }
  | { kind: 'day'; value: string[] };

interface Question {
  n: number;
  text: string;
  tool?: string | string[];
  expected?: (restaurantId: string) => Promise<Expected>;
}

const count = (value: number, unit?: string): Expected => ({ kind: 'count', value, unit });

// Mois précédent à Paris, au format AAAA-MM (Date.UTC accepte le mois -1 : janvier → décembre).
function previousMonth(): string {
  const [year, month] = dayFormat.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

const QUESTIONS: Question[] = [
  {
    n: 1,
    text: "Combien de réservations ont été prises aujourd'hui ?",
    tool: 'reservation_stats',
    expected: async (id) => count((await computeDashboardStats(id, 'today')).total_reservations),
  },
  {
    n: 2,
    text: 'Combien de couverts ont été réservés ces 7 derniers jours ?',
    tool: 'reservation_stats',
    expected: async (id) => count((await computeDashboardStats(id, '7d')).covers),
  },
  {
    n: 3,
    text: "Combien d'appels sur les 30 derniers jours ?",
    tool: ['reservation_stats', 'call_stats'],
    expected: async (id) => count((await computeDashboardStats(id, '30d')).total_calls),
  },
  {
    n: 4,
    text: 'Quel est le taux de conversion des appels sur 7 jours ?',
    tool: ['reservation_stats', 'call_stats'],
    expected: async (id) => {
      const rate = (await computeDashboardStats(id, '7d')).conversion_rate;
      return { kind: 'rate', value: rate, rates: [rate] };
    },
  },
  {
    n: 5,
    text: 'Combien de couverts sont prévus demain ?',
    tool: 'upcoming_days',
    expected: async (id) => count((await computeEmptySlots(id)).days[1].covers),
  },
  {
    n: 6,
    text: 'Quel est le jour le plus faible des 7 prochains jours ?',
    tool: 'upcoming_days',
    expected: async (id) => {
      const open = (await computeEmptySlots(id)).days.filter((day) => day.isOpen);
      const lowest = Math.min(...open.map((day) => day.reservationCount));
      return {
        kind: 'day',
        value: open
          .filter((day) => day.reservationCount === lowest)
          .map((day) => DAY_NAMES[day.dayName]),
      };
    },
  },
  {
    n: 7,
    text: 'Combien de jours sous-réservés dans les 7 prochains jours ?',
    tool: 'upcoming_days',
    expected: async (id) => count((await computeEmptySlots(id)).summary.underbookedDays, 'jours?'),
  },
  {
    n: 8,
    text: 'Quel est mon taux de no-show ?',
    tool: 'no_shows',
    expected: async (id) => ({ kind: 'rate', value: (await computeNoShowStats(id)).noShowRate }),
  },
  {
    n: 9,
    text: 'Combien de no-shows sur les 90 derniers jours ?',
    tool: 'no_shows',
    expected: async (id) => count((await computeNoShowStats(id)).noShows),
  },
  {
    n: 10,
    text: 'Combien de couverts le mois dernier ?',
    tool: 'monthly_roi',
    expected: async (id) => count((await computeRoi(id, previousMonth())).totalCouverts),
  },
  {
    n: 11,
    text: "Combien Sokar m'a fait économiser en commissions TheFork le mois dernier ?",
    tool: 'monthly_roi',
    expected: async (id) => ({
      kind: 'amount',
      value: (await computeRoi(id, previousMonth())).theforkSavings,
    }),
  },
  { n: 12, text: 'Combien de couverts avons-nous servis mardi dernier ?' },
  { n: 13, text: "Quel est le nom du client qui n'est pas venu hier ?" },
  { n: 14, text: "Quel est mon chiffre d'affaires net après charges ?" },
  { n: 15, text: "Rédigez un SMS pour relancer la liste d'attente samedi." },
  { n: 16, text: 'Rédigez un message pour annoncer une soirée spéciale vendredi.' },
  {
    n: 17,
    text: "Combien d'appels avons-nous reçus ces 7 derniers jours ?",
    tool: 'call_stats',
    expected: async (id) => count((await computeCallStats(id, '7d')).total),
  },
  {
    n: 18,
    text: "Combien d'appels hors horaires sur 30 jours ?",
    tool: 'call_stats',
    expected: async (id) => {
      const { afterHours } = await computeCallStats(id, '30d');
      if (afterHours === null)
        throw new Error('horaires absents : appels hors horaires non notables');
      return count(afterHours);
    },
  },
  {
    n: 19,
    text: "Combien d'appels ont abouti à une réservation cette semaine ?",
    tool: 'call_stats',
    expected: async (id) => {
      const calls = await computeCallStats(id, '7d');
      const dashboard = await computeDashboardStats(id, '7d');
      return {
        kind: 'count',
        value: calls.byOutcome.RESERVED,
        alt: dashboard.call_reservations,
        rates: [dashboard.conversion_rate],
      };
    },
  },
];

// Nombres en lettres pour la question 7 : « Un seul jour est sous-réservé ».
const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

// Un nombre de la réponse suffit. Accepte « 1 234 », « 1234 », « 4,2 » et « 4.2 ».
function numbersIn(reply: string): number[] {
  const tokens = reply.match(/\d{1,3}(?:[\s  ]\d{3})+(?:[,.]\d+)?|\d+(?:[,.]\d+)?/g) ?? [];
  return tokens.map((token) => Number(token.replace(/[\s  ]/g, '').replace(',', '.')));
}

// Pourcentages cités : nombre suivi de « % » ou de « pour cent ».
function percentagesIn(reply: string): number[] {
  return [...reply.matchAll(/(\d+(?:[,.]\d+)?)\s*(?:%|pour cent)/gi)].map(([, value]) =>
    Number(value.replace(',', '.')),
  );
}

// Compte exact ; montant à l'euro près ; taux à 0,1 près ; jour : nom complet, sans accent ni casse.
function valueFound(reply: string, expected: Expected): boolean {
  if (expected.kind === 'day') {
    const text = reply
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    return expected.value.some((name) => text.includes(name));
  }
  // Le nombre doit être suivi de son unité : un « 1 » quelconque ne compte pas.
  if (expected.unit) {
    const number = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`;
    const pattern = new RegExp(`\\b(${number})\\s+(?:seul(?:e?s)?\\s+)?${expected.unit}\\b`, 'gi');
    return [...reply.matchAll(pattern)].some(([, token]) => {
      const key = token.toLowerCase();
      return (NUMBER_WORDS[key] ?? Number(key)) === expected.value;
    });
  }
  // Un pourcentage qu'aucun outil n'a renvoyé est un taux calculé par le modèle : KO.
  const rates = expected.rates;
  if (
    rates &&
    percentagesIn(reply).some((p) => !rates.some((rate) => Math.abs(p - rate) <= 0.05))
  ) {
    return false;
  }
  const wanted = [expected.value, expected.alt].filter(
    (value): value is number => value !== undefined,
  );
  const tolerance = { count: 0, amount: 0.5, rate: 0.05 }[expected.kind];
  return numbersIn(reply).some((n) =>
    wanted.some((value) => Math.abs(n - value) <= tolerance + 1e-9),
  );
}

function formatExpected(expected: Expected | undefined): string {
  if (!expected) return '';
  if (expected.kind === 'day') return expected.value.join(' / ');
  return expected.alt === undefined
    ? String(expected.value)
    : `${expected.value} ou ${expected.alt}`;
}

interface Trial {
  reply: string;
  sources: string[];
  toolOk: boolean | null;
  valueOk: boolean | null;
  input_tokens: number;
  output_tokens: number;
  error?: string;
}

// answerCompanion ne renvoie pas les tokens : ils sont dans la ligne de journal de chaque appel.
let lastUsage = { input_tokens: 0, output_tokens: 0 };
const usageLog = {
  info: (fields: { input_tokens: number; output_tokens: number }) => {
    lastUsage = { input_tokens: fields.input_tokens, output_tokens: fields.output_tokens };
  },
} as unknown as FastifyBaseLogger;

async function runTrial(
  question: Question,
  expected: Expected | undefined,
  restaurantId: string,
): Promise<Trial> {
  lastUsage = { input_tokens: 0, output_tokens: 0 };
  try {
    const answer = await answerCompanion({
      restaurantId,
      messages: [{ role: 'user', content: question.text }],
      log: usageLog,
    });
    const sources = answer.sources.map((source) => source.tool);
    return {
      reply: answer.reply,
      sources,
      toolOk: question.tool ? [question.tool].flat().some((tool) => sources.includes(tool)) : null,
      valueOk: expected ? valueFound(answer.reply, expected) : null,
      ...lastUsage,
    };
  } catch (error) {
    return {
      reply: '',
      sources: [],
      toolOk: question.tool ? false : null,
      valueOk: expected ? false : null,
      error: error instanceof Error ? error.message : String(error),
      ...lastUsage,
    };
  }
}

function isLocalDatabase(rawUrl: string | undefined): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(rawUrl ?? '').hostname);
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production' || !isLocalDatabase(process.env.DATABASE_URL)) {
    throw new Error('banc refusé : NODE_ENV=production ou DATABASE_URL hors localhost.');
  }
  const restaurantId = process.env.DEMO_RESTAURANT_ID;
  if (!restaurantId) throw new Error('DEMO_RESTAURANT_ID absent (apps/api/.env).');
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY absente (apps/api/.env).');
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });
  if (!restaurant) throw new Error(`restaurant ${restaurantId} introuvable dans cette base.`);

  const startedAt = new Date().toISOString();
  const results = [];
  for (const question of QUESTIONS) {
    const expected = question.expected ? await question.expected(restaurantId) : undefined;
    const trials: Trial[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      trials.push(await runTrial(question, expected, restaurantId));
    }
    results.push({
      n: question.n,
      text: question.text,
      tool: question.tool ?? null,
      expected: expected ?? null,
      trials,
    });
    // eslint-disable-next-line no-console -- progression du banc, lue dans le terminal
    console.log(`Question ${question.n} : ${trials.length} essais`);
  }

  console.table(
    results
      .filter((result) => result.tool)
      .map((result) => ({
        '#': result.n,
        Question: result.text,
        Outil: result.trials.map((trial) => (trial.toolOk ? 'OK' : 'KO')).join(' '),
        Chiffre: result.trials.map((trial) => (trial.valueOk ? 'OK' : 'KO')).join(' '),
        Attendu: formatExpected(result.expected ?? undefined),
      })),
  );

  const trials = results.flatMap((result) => result.trials);
  const tokens = {
    input_tokens: trials.reduce((sum, trial) => sum + trial.input_tokens, 0),
    output_tokens: trials.reduce((sum, trial) => sum + trial.output_tokens, 0),
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { startedAt, model: env.COMPANION_LLM_MODEL, tokens, questions: results },
      null,
      2,
    ) + '\n',
  );
  // eslint-disable-next-line no-console -- résumé du banc, lu dans le terminal
  console.log(
    `Tokens : ${tokens.input_tokens} entrée, ${tokens.output_tokens} sortie (${trials.length} appels).`,
  );
  // eslint-disable-next-line no-console -- chemin du fichier de résultats
  console.log(`Résultats : ${file}`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
