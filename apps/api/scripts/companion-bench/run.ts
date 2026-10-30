/**
 * Banc de questions du Companion : chaque question part 3 fois dans answerCompanion, avec la vraie
 * clé OpenRouter, directement (ni HTTP ni plafond), sur la base locale de DEMO_RESTAURANT_ID.
 *
 * Usage (depuis apps/api) : npx tsx scripts/companion-bench/run.ts
 * Les chiffres attendus se recalculent au moment du test. Ceux des questions 12, 22 à 27 viennent de
 * requêtes Prisma écrites ici, indépendantes de query-data.ts.
 * Questions notées : 1 à 12, 17 à 20 et 22 à 27 (outil attendu dans les sources, puis valeur attendue
 * dans la réponse, chaque critère noté à part). Questions à relire : 13 à 16, 21 et 28 ; réponses
 * brutes dans results/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReservationState } from '@prisma/client';
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
  | { kind: 'day'; value: string[] }
  | { kind: 'all'; value: number[] }
  | { kind: 'any'; value: number[] }
  | { kind: 'first'; value: string[]; others: string[] };

interface Question {
  n: number;
  text: string;
  tool?: string | string[];
  expected?: (restaurantId: string) => Promise<Expected>;
}

const count = (value: number, unit?: string): Expected => ({ kind: 'count', value, unit });

// Calculs de référence, écrits ici : aucun ne passe par query-data.ts.
const COUNTED_STATES: ReservationState[] = ['CONFIRMED', 'SEATED', 'HONORED'];
const benchClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});
const benchWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
});
const benchHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  hour: 'numeric',
});
const FRENCH_WEEKDAYS: Record<string, string> = {
  Sunday: 'dimanche',
  Monday: 'lundi',
  Tuesday: 'mardi',
  Wednesday: 'mercredi',
  Thursday: 'jeudi',
  Friday: 'vendredi',
  Saturday: 'samedi',
};
const CHANNEL_LABELS: Record<string, string[]> = {
  phone: ['telephone'],
  website: ['site'],
  google: ['google'],
  ai: ['assistant', 'chatgpt', 'ia'],
  team: ['equipe', 'saisie'],
};

const today = () => dayFormat.format(new Date());
function shiftDay(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
// Décalage de Paris à cet instant (en ms), puis minuit de Paris en instant UTC.
function parisOffset(instant: number): number {
  const parts = Object.fromEntries(
    benchClock.formatToParts(new Date(instant)).map(({ type, value }) => [type, Number(value)]),
  );
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    instant
  );
}
function parisStart(dayKey: string): Date {
  const wall = Date.parse(`${dayKey}T00:00:00Z`);
  return new Date(wall - parisOffset(wall - parisOffset(wall)));
}
// Premier et dernier jour d'un mois AAAA-MM.
function monthBounds(yearMonth: string): [string, string] {
  const [year, month] = yearMonth.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return [`${yearMonth}-01`, shiftDay(nextMonth, -1)];
}
// Dernier jour de cette semaine ouvrée donnée (0 = dimanche), avant le jour indiqué.
function lastWeekdayBefore(dayKey: string, weekday: number): string {
  let day = shiftDay(dayKey, -1);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== weekday) day = shiftDay(day, -1);
  return day;
}
// Réservations de la plage, par date de service (reservedAt) ou de prise (createdAt), à Paris.
function reservationsBetween(
  restaurantId: string,
  dateField: 'reservedAt' | 'createdAt',
  from: string,
  to: string,
  states: ReservationState[] = COUNTED_STATES,
) {
  const range = { gte: parisStart(from), lt: parisStart(shiftDay(to, 1)) };
  return db.reservation.findMany({
    where: {
      restaurantId,
      state: { in: states },
      ...(dateField === 'reservedAt' ? { reservedAt: range } : { createdAt: range }),
    },
    select: {
      reservedAt: true,
      createdAt: true,
      state: true,
      channel: true,
      source: true,
      partySize: true,
    },
  });
}
// Canal d'arrivée (phone, website, google, ai, team), réécrit ici.
function benchChannel(row: { channel: string; source: string | null }): string {
  if (row.channel === 'PHONE') return 'phone';
  if (row.channel === 'ADMIN') return 'team';
  if (['MCP', 'OPENAI_RESERVE', 'API'].includes(row.channel)) return 'ai';
  if (row.channel === 'WEB') {
    const source = (row.source ?? '').toLowerCase();
    if (source === 'google') return 'google';
    if (['chatgpt', 'perplexity', 'bing'].includes(source)) return 'ai';
  }
  return 'website';
}
function benchWeekdayName(date: Date): string {
  return FRENCH_WEEKDAYS[benchWeekday.format(date)];
}
// Clés dont la valeur est la plus haute (égalités comprises).
function topKeys<K>(totals: Map<K, number>): K[] {
  const max = Math.max(...totals.values());
  return [...totals].filter(([, value]) => value === max).map(([key]) => key);
}
function sumCovers(rows: Array<{ partySize: number }>): number {
  return rows.reduce((sum, row) => sum + row.partySize, 0);
}

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
    tool: ['reservation_stats', 'query_data'],
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
    tool: ['monthly_roi', 'query_data'],
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
  {
    n: 12,
    text: 'Combien de couverts avons-nous servis mardi dernier ?',
    tool: 'query_data',
    expected: async (id) => {
      const day = lastWeekdayBefore(today(), 2);
      return count(sumCovers(await reservationsBetween(id, 'reservedAt', day, day)));
    },
  },
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
  {
    n: 20,
    text: 'Par quel moyen les clients réservent-ils, sur 30 jours ?',
    tool: 'reservation_stats',
    expected: async (id) => {
      const channels = (await computeDashboardStats(id, '30d')).by_channel;
      const reservations = (channel: string) =>
        channels.find((stat) => stat.channel === channel)?.reservations ?? 0;
      return { kind: 'all', value: [reservations('phone'), reservations('website')] };
    },
  },
  { n: 21, text: 'Par quel moyen les gens appellent ?' },
  {
    n: 22,
    text: 'Quel jour de la semaine fait le plus de couverts sur les 8 dernières semaines ?',
    tool: 'query_data',
    expected: async (id) => {
      const covers = new Map<string, number>();
      for (const row of await reservationsBetween(
        id,
        'reservedAt',
        shiftDay(today(), -55),
        today(),
      )) {
        const name = benchWeekdayName(row.reservedAt);
        covers.set(name, (covers.get(name) ?? 0) + row.partySize);
      }
      return { kind: 'day', value: topKeys(covers) };
    },
  },
  {
    n: 23,
    text: 'Combien de réservations annulées en septembre ?',
    tool: 'query_data',
    expected: async (id) => {
      const [from, to] = monthBounds(`${today().slice(0, 4)}-09`);
      const byService = await reservationsBetween(id, 'reservedAt', from, to, ['CANCELLED']);
      const byCreated = await reservationsBetween(id, 'createdAt', from, to, ['CANCELLED']);
      return { kind: 'any', value: [byService.length, byCreated.length] };
    },
  },
  {
    n: 24,
    text: 'Combien de couverts via le site web le mois dernier ?',
    tool: 'query_data',
    expected: async (id) => {
      const [from, to] = monthBounds(previousMonth());
      const rows = await reservationsBetween(id, 'reservedAt', from, to);
      return count(sumCovers(rows.filter((row) => benchChannel(row) === 'website')));
    },
  },
  {
    n: 25,
    text: "Combien d'appels pour des annulations sur 30 jours ?",
    tool: 'query_data',
    expected: async (id) =>
      count(
        await db.call.count({
          where: {
            restaurantId: id,
            intent: 'CANCEL',
            createdAt: {
              gte: parisStart(shiftDay(today(), -29)),
              lt: parisStart(shiftDay(today(), 1)),
            },
          },
        }),
      ),
  },
  {
    n: 26,
    text: 'Quel canal apporte le plus de couverts sur 90 jours ?',
    tool: 'query_data',
    expected: async (id) => {
      const covers = new Map<string, number>();
      for (const row of await reservationsBetween(
        id,
        'createdAt',
        shiftDay(today(), -89),
        today(),
      )) {
        const channel = benchChannel(row);
        covers.set(channel, (covers.get(channel) ?? 0) + row.partySize);
      }
      // Le canal attendu doit être le premier nommé : les autres canaux ne doivent pas venir avant.
      const winners = topKeys(covers);
      const others = Object.keys(CHANNEL_LABELS).filter((channel) => !winners.includes(channel));
      return {
        kind: 'first',
        value: winners.flatMap((channel) => CHANNEL_LABELS[channel]),
        others: others.flatMap((channel) => CHANNEL_LABELS[channel]),
      };
    },
  },
  {
    n: 27,
    text: 'À quelle heure arrivent la plupart des clients le samedi, sur 8 semaines ?',
    tool: 'query_data',
    expected: async (id) => {
      const perHour = new Map<number, number>();
      for (const row of await reservationsBetween(
        id,
        'reservedAt',
        shiftDay(today(), -55),
        today(),
      )) {
        if (benchWeekdayName(row.reservedAt) !== 'samedi') continue;
        const hour = Number(benchHour.format(row.reservedAt));
        perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
      }
      return { kind: 'any', value: topKeys(perHour) };
    },
  },
  { n: 28, text: "Combien de personnes sont sur la liste d'attente ?" },
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
  if (expected.kind === 'all') {
    return expected.value.every((value) => numbersIn(reply).includes(value));
  }
  if (expected.kind === 'any') {
    return numbersIn(reply).some((n) => expected.value.includes(n));
  }
  if (expected.kind === 'first') {
    const text = reply
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    return firstMention(text, expected.value) < firstMention(text, expected.others);
  }
  if (expected.kind === 'day') {
    const text = reply
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    return expected.value.some((name) => new RegExp(`\\b${name}\\b`).test(text));
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
  if (expected.kind === 'all') return expected.value.join(' et ');
  if (expected.kind === 'any') return expected.value.join(' ou ');
  if (expected.kind === 'first') return expected.value.join(' / ');
  return expected.alt === undefined
    ? String(expected.value)
    : `${expected.value} ou ${expected.alt}`;
}

// Appel d'outil tel que le modèle l'a émis, avec le contenu renvoyé (agrégats uniquement).
interface ToolCall {
  name: string;
  arguments: string;
  result: unknown;
}

// Position du premier libellé trouvé dans le texte (Infinity si aucun).
function firstMention(text: string, labels: string[]): number {
  const positions = labels
    .map((label) => text.search(new RegExp(`\\b${label}\\b`)))
    .filter((position) => position >= 0);
  return Math.min(...positions, Infinity);
}

interface Trial {
  reply: string;
  sources: string[];
  calls: ToolCall[];
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
  const calls: ToolCall[] = [];
  try {
    const answer = await answerCompanion({
      restaurantId,
      messages: [{ role: 'user', content: question.text }],
      log: usageLog,
      onToolCall: (call) => calls.push(call),
    });
    const sources = answer.sources.map((source) => source.tool);
    return {
      reply: answer.reply,
      sources,
      calls,
      toolOk: question.tool ? [question.tool].flat().some((tool) => sources.includes(tool)) : null,
      valueOk: expected ? valueFound(answer.reply, expected) : null,
      ...lastUsage,
    };
  } catch (error) {
    return {
      reply: '',
      sources: [],
      calls,
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
