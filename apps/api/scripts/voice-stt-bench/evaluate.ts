/**
 * Banc STT vocal — évaluation des transcriptions avec le code de dialogue réel.
 *
 * Pour chaque phrase, l'agent pose la question correspondante, puis la
 * transcription passe par `recordUserTurn` (le chemin de production), flag
 * coupé puis flag actif. Chaque fait attendu est classé :
 *   - correct   : la bonne valeur est retenue ;
 *   - wrong     : une autre valeur est retenue (le cas dangereux) ;
 *   - choix ok / choix ko : l'agent demande « X ou Y ? », bonne valeur incluse ou non ;
 *   - redemandé : rien n'est retenu, la question sera reposée.
 * Pour une réponse hors sujet, « correct » veut dire : rien retenu, rien proposé.
 *
 * Usage : pnpm --filter @sokar/api exec tsx scripts/voice-stt-bench/evaluate.ts phrases.json transcripts.json
 * `BENCH_VERBOSE=1` liste les cas `wrong` et les faux positifs hors sujet (flag actif).
 */
import { readFileSync } from 'node:fs';
import {
  classifyVoiceSpeechActInContext,
  createConversationState,
  recordAssistantReplyFromLlmTextFallback,
  recordUserTurn,
} from '../../src/modules/voice/stream/conversation-controller';
import type { CallSession } from '../../src/modules/voice/stream/types';
import type { BenchPhrase } from './phrases';

interface TranscriptResult {
  id: string;
  transcript: string;
  error: string | null;
}

type Outcome = 'correct' | 'wrong' | 'choiceOk' | 'choiceKo' | 'reprompt';
const OUTCOMES: Outcome[] = ['correct', 'wrong', 'choiceOk', 'choiceKo', 'reprompt'];

const NOW = new Date('2026-09-23T10:00:00Z'); // mercredi
const QUESTIONS: Record<BenchPhrase['question'], string | null> = {
  partySize: 'Vous serez combien ?',
  date: 'Pour quel jour ?',
  time: 'Vous voulez venir vers quelle heure ?',
  open: null,
};
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function addDays(days: number): string {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Intervalle de confiance de Wilson à 95 %. */
function wilson(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 0];
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function makeSession(question: string | null): CallSession {
  const session = {
    conversation: createConversationState(),
    restaurantId: 'bench-restaurant',
    timezone: 'Europe/Paris',
    voiceLanguageCode: 'fr',
    history: [],
  } as unknown as CallSession;
  session.conversation.intent = 'reservation';
  if (question) recordAssistantReplyFromLlmTextFallback(session, question);
  return session;
}

interface Evaluation {
  tally: Record<string, Record<Outcome, number>>;
  details: string[];
}

function evaluate(phrases: BenchPhrase[], transcripts: Map<string, TranscriptResult>): Evaluation {
  const tally: Record<string, Record<Outcome, number>> = {};
  const details: string[] = [];
  const count = (fact: string, outcome: Outcome) => {
    tally[fact] ??= { correct: 0, wrong: 0, choiceOk: 0, choiceKo: 0, reprompt: 0 };
    tally[fact][outcome]++;
  };

  for (const phrase of phrases) {
    const transcript = transcripts.get(phrase.id)?.transcript ?? '';
    const session = makeSession(QUESTIONS[phrase.question]);
    const before = { ...session.conversation.slots };
    if (transcript) {
      recordUserTurn(
        session,
        transcript,
        classifyVoiceSpeechActInContext(session, transcript),
        NOW,
      );
    }
    const { slots, answerChoice } = session.conversation;

    if (phrase.expected.offTopic) {
      const retained = (['partySize', 'date', 'time'] as const).find(
        (slot) => slots[slot] !== undefined && slots[slot] !== before[slot],
      );
      if (retained) {
        count('hors sujet', 'wrong');
        details.push(
          `hors sujet ${phrase.id} « ${phrase.text} » → « ${transcript} » → ${retained}=${slots[retained]}`,
        );
      } else if (answerChoice) {
        count('hors sujet', 'choiceKo');
        details.push(
          `hors sujet ${phrase.id} « ${phrase.text} » → « ${transcript} » → choix ${answerChoice.values.join('/')}`,
        );
      } else count('hors sujet', 'correct');
      continue;
    }

    const facts: Array<[string, string, string | undefined, 'partySize' | 'weekday' | 'time']> = [];
    // Au-delà de 7, la réservation vocale ne retient pas le nombre : mesuré à part.
    if (phrase.expected.partySize !== undefined)
      facts.push([
        phrase.expected.partySize <= 7 ? 'personnes' : 'groupe > 7',
        String(phrase.expected.partySize),
        slots.partySize?.toString(),
        'partySize',
      ]);
    if (phrase.expected.weekday)
      facts.push([
        'jour',
        phrase.expected.weekday,
        slots.date ? weekdayOf(slots.date) : undefined,
        'weekday',
      ]);
    if (phrase.expected.relativeDays !== undefined) {
      const expectedDate = addDays(phrase.expected.relativeDays);
      facts.push([
        'jour',
        weekdayOf(expectedDate),
        slots.date ? weekdayOf(slots.date) : undefined,
        'weekday',
      ]);
    }
    if (phrase.expected.time) facts.push(['heure', phrase.expected.time, slots.time, 'time']);

    for (const [fact, expected, actual, choiceKind] of facts) {
      if (actual === expected) count(fact, 'correct');
      else if (actual !== undefined) {
        count(fact, 'wrong');
        details.push(
          `${fact} ${phrase.id} « ${phrase.text} » → « ${transcript} » → ${actual} (attendu ${expected})`,
        );
      } else if (answerChoice?.kind === choiceKind) {
        count(fact, answerChoice.values.includes(expected) ? 'choiceOk' : 'choiceKo');
      } else count(fact, 'reprompt');
    }
  }
  return { tally, details };
}

function withFlag<T>(enabled: boolean, run: () => T): T {
  const previous = process.env.VOICE_EXPECTED_ANSWER_ENABLED;
  process.env.VOICE_EXPECTED_ANSWER_ENABLED = enabled ? 'true' : 'false';
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.VOICE_EXPECTED_ANSWER_ENABLED;
    else process.env.VOICE_EXPECTED_ANSWER_ENABLED = previous;
  }
}

function main(): void {
  const [phrasesPath, transcriptsPath] = process.argv.slice(2);
  const phrases = JSON.parse(readFileSync(phrasesPath, 'utf8')) as BenchPhrase[];
  const transcripts = new Map(
    (JSON.parse(readFileSync(transcriptsPath, 'utf8')) as TranscriptResult[]).map((r) => [r.id, r]),
  );
  const pct = (value: number) => `${(100 * value).toFixed(0)} %`;
  const lines: string[] = [
    `N = ${phrases.length} phrases`,
    '| Type | Flag | n | correct [IC 95 %] | wrong [IC 95 %] | choix ok | choix ko | redemandé |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const results = {
    off: withFlag(false, () => evaluate(phrases, transcripts)),
    on: withFlag(true, () => evaluate(phrases, transcripts)),
  };
  const types = [...new Set([...Object.keys(results.off.tally), ...Object.keys(results.on.tally)])];
  for (const type of types) {
    for (const flag of ['off', 'on'] as const) {
      const t = results[flag].tally[type];
      if (!t) continue;
      const n = OUTCOMES.reduce((sum, outcome) => sum + t[outcome], 0);
      const [cLow, cHigh] = wilson(t.correct, n);
      const [wLow, wHigh] = wilson(t.wrong, n);
      lines.push(
        `| ${type} | ${flag === 'on' ? 'actif' : 'coupé'} | ${n} | ${t.correct} (${pct(t.correct / n)}) [${pct(cLow)}–${pct(cHigh)}] | ` +
          `${t.wrong} (${pct(t.wrong / n)}) [${pct(wLow)}–${pct(wHigh)}] | ${t.choiceOk} | ${t.choiceKo} | ${t.reprompt} |`,
      );
    }
  }
  if (process.env.BENCH_VERBOSE)
    lines.push('', 'Cas wrong et faux positifs (flag actif) :', ...results.on.details);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
