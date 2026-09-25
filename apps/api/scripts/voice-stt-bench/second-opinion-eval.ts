/**
 * Banc « deuxième transcription » — analyse locale (gratuite).
 *
 * Chaque transcription (A = Scribe Realtime, B = Scribe batch, même audio) passe
 * par le chemin de production : question posée, `recordUserTurn`, rapprochement
 * de la phase 1 actif, confirmation par la confiance coupée. On compare ensuite,
 * par type, la valeur retenue par A, celle retenue par B et la valeur attendue.
 *
 * Usage :
 *   pnpm --filter @sokar/api exec tsx scripts/voice-stt-bench/second-opinion-eval.ts \
 *     phrases.json second-opinion.json [phrases2.json second-opinion2.json …]
 * `BENCH_VERBOSE=1` liste tous les désaccords.
 */
import { readFileSync } from 'node:fs';
import {
  classifyVoiceSpeechActInContext,
  createConversationState,
  recordAssistantReplyFromLlmTextFallback,
  recordUserTurn,
} from '../../src/modules/voice/stream/conversation-controller';
import { valueConfidence } from '../../src/modules/voice/stream/slot-confidence';
import type { CallSession } from '../../src/modules/voice/stream/types';
import type { BenchPhrase } from './phrases';

interface EngineResult {
  transcript: string;
  words?: Array<{ word: string; logprob: number | null }>;
  latencyMs?: number;
  error: string | null;
}

interface SecondOpinionResult {
  id: string;
  durationMs?: number;
  realtime?: EngineResult;
  batch?: EngineResult;
  error?: string;
}

type Kind = 'partySize' | 'weekday' | 'time';

interface Fact {
  type: string;
  id: string;
  text: string;
  expected: string;
  a: string | undefined;
  b: string | undefined;
  confidence: number | null;
  transcriptA: string;
  transcriptB: string;
}

const NOW = new Date('2026-09-23T10:00:00Z'); // mercredi
const QUESTIONS: Record<BenchPhrase['question'], string | null> = {
  partySize: 'Vous serez combien ?',
  date: 'Pour quel jour ?',
  time: 'Vous voulez venir vers quelle heure ?',
  open: null,
};
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/** Seuil « confiance basse » de la phase 2 (réglé sur la calibration difficile). */
const LOW_CONFIDENCE = 0.25;

function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function addDays(days: number): string {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function words(engine: EngineResult | undefined) {
  return engine?.words?.map((word) => ({
    word: word.word,
    ...(typeof word.logprob === 'number' ? { confidence: Math.exp(word.logprob) } : {}),
  }));
}

/** Valeurs retenues par le dialogue de production pour une transcription. */
function interpret(phrase: BenchPhrase, transcript: string): Record<Kind, string | undefined> {
  const session = {
    conversation: createConversationState(),
    restaurantId: 'bench-restaurant',
    timezone: 'Europe/Paris',
    voiceLanguageCode: 'fr',
    history: [],
  } as unknown as CallSession;
  session.conversation.intent = 'reservation';
  const question = QUESTIONS[phrase.question];
  if (question) recordAssistantReplyFromLlmTextFallback(session, question);
  if (transcript) {
    recordUserTurn(session, transcript, classifyVoiceSpeechActInContext(session, transcript), NOW);
  }
  const { slots } = session.conversation;
  return {
    partySize: slots.partySize === undefined ? undefined : String(slots.partySize),
    weekday: slots.date ? weekdayOf(slots.date) : undefined,
    time: slots.time,
  };
}

function expectedFacts(phrase: BenchPhrase): Array<[string, Kind, string]> {
  const facts: Array<[string, Kind, string]> = [];
  if (phrase.expected.partySize !== undefined)
    facts.push(['personnes', 'partySize', String(phrase.expected.partySize)]);
  if (phrase.expected.weekday) facts.push(['jour', 'weekday', phrase.expected.weekday]);
  if (phrase.expected.relativeDays !== undefined)
    facts.push(['jour', 'weekday', weekdayOf(addDays(phrase.expected.relativeDays))]);
  if (phrase.expected.time) facts.push(['heure', 'time', phrase.expected.time]);
  return facts;
}

function collect(phrases: BenchPhrase[], results: Map<string, SecondOpinionResult>): Fact[] {
  const facts: Fact[] = [];
  for (const phrase of phrases) {
    const result = results.get(phrase.id);
    const transcriptA = result?.realtime?.transcript?.trim() ?? '';
    const transcriptB = result?.batch?.transcript?.trim() ?? '';
    // Hors transcriptions vides : seul A compte, c'est lui qui pilote l'appel.
    if (!transcriptA || phrase.expected.offTopic) continue;
    const a = interpret(phrase, transcriptA);
    const b = interpret(phrase, transcriptB);
    for (const [type, kind, expected] of expectedFacts(phrase)) {
      facts.push({
        type,
        id: phrase.id,
        text: phrase.text,
        expected,
        a: a[kind],
        b: b[kind],
        confidence:
          a[kind] === undefined ? null : valueConfidence(kind, a[kind]!, words(result?.realtime)),
        transcriptA,
        transcriptB,
      });
    }
  }
  return facts;
}

const pct = (part: number, total: number) =>
  total ? `${((100 * part) / total).toFixed(0)} % (${part}/${total})` : '—';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
}

/**
 * Rappel de la confiance à taux de fausses alertes égal : seuil choisi pour que
 * la part des A justes sous le seuil soit au plus celle des désaccords.
 */
function confidenceRecallAt(falseAlarmRate: number, right: Fact[], wrong: Fact[]): string {
  const scored = (list: Fact[]) => list.map((fact) => fact.confidence ?? 1);
  const rightScores = scored(right);
  const wrongScores = scored(wrong);
  const candidates = [...new Set([...rightScores, ...wrongScores, 0])].sort((x, y) => x - y);
  let best = { threshold: 0, recall: 0 };
  for (const threshold of candidates) {
    const alarms = rightScores.filter((score) => score < threshold).length / rightScores.length;
    if (alarms > falseAlarmRate) break;
    best = {
      threshold,
      recall: wrongScores.filter((score) => score < threshold).length,
    };
  }
  return `${pct(best.recall, wrongScores.length)} (seuil ${best.threshold.toFixed(2)})`;
}

function main(): void {
  const args = process.argv.slice(2);
  const facts: Fact[] = [];
  const latencies: number[] = [];
  const durations: number[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const phrases = JSON.parse(readFileSync(args[index], 'utf8')) as BenchPhrase[];
    const results = new Map(
      (JSON.parse(readFileSync(args[index + 1], 'utf8')) as SecondOpinionResult[]).map((r) => [
        r.id,
        r,
      ]),
    );
    facts.push(...collect(phrases, results));
    for (const result of results.values()) {
      const duration = result.durationMs ?? 0;
      if (duration) durations.push(duration);
      // Délai mesuré sur les extraits de 1 à 4 s, comme un tour d'appel.
      if (result.batch?.latencyMs && !result.batch.error && duration >= 1000 && duration <= 4000) {
        latencies.push(result.batch.latencyMs);
      }
    }
  }

  const lines = [
    '| Type | n | précision A | précision B | accord A/B | rappel du désaccord | fausses alertes | rappel de la confiance à fausses alertes égales | bonne valeur dans A ou B (si désaccord) | désaccord OU confiance basse (rappel / fausses alertes) | désaccord ET confiance basse (rappel / fausses alertes) |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const disagreements: string[] = [];
  for (const type of ['personnes', 'jour', 'heure']) {
    const list = facts.filter((fact) => fact.type === type);
    if (!list.length) continue;
    const retained = list.filter((fact) => fact.a !== undefined);
    const right = retained.filter((fact) => fact.a === fact.expected);
    const wrong = retained.filter((fact) => fact.a !== fact.expected);
    const disagree = (fact: Fact) => fact.b !== fact.a;
    const low = (fact: Fact) => fact.confidence !== null && fact.confidence < LOW_CONFIDENCE;
    const diverging = retained.filter(disagree);
    const falseAlarmRate = right.filter(disagree).length / Math.max(1, right.length);
    const flagged = (rule: (fact: Fact) => boolean) =>
      `${pct(wrong.filter(rule).length, wrong.length)} / ${pct(right.filter(rule).length, right.length)}`;
    lines.push(
      `| ${type} | ${list.length} | ${pct(list.filter((f) => f.a === f.expected).length, list.length)} | ` +
        `${pct(list.filter((f) => f.b === f.expected).length, list.length)} | ` +
        `${pct(retained.length - diverging.length, retained.length)} | ` +
        `${pct(wrong.filter(disagree).length, wrong.length)} | ${pct(right.filter(disagree).length, right.length)} | ` +
        `${confidenceRecallAt(falseAlarmRate, right, wrong)} | ` +
        `${pct(diverging.filter((f) => f.a === f.expected || f.b === f.expected).length, diverging.length)} | ` +
        `${flagged((f) => disagree(f) || low(f))} | ${flagged((f) => disagree(f) && low(f))} |`,
    );
    for (const fact of diverging) {
      if (type === 'heure' || process.env.BENCH_VERBOSE) {
        disagreements.push(
          `${type} ${fact.id} « ${fact.text} » → A « ${fact.transcriptA} » = ${fact.a} ; B « ${fact.transcriptB} » = ${fact.b ?? '∅'} ; attendu ${fact.expected} ; confiance A ${fact.confidence?.toFixed(2) ?? '?'}`,
        );
      }
    }
  }
  lines.push(
    '',
    `Délai du batch (extraits de 1 à 4 s, n = ${latencies.length}) : p50 ${percentile(latencies, 50)} ms, p95 ${percentile(latencies, 95)} ms`,
    `Durée moyenne d'un extrait : ${(durations.reduce((sum, d) => sum + d, 0) / Math.max(1, durations.length) / 1000).toFixed(2)} s`,
    '',
    'Désaccords (toutes les heures ; tous les types avec BENCH_VERBOSE=1) :',
    ...disagreements,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
