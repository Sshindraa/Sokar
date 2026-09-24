/**
 * Banc STT vocal — évaluation des transcriptions avec le code de dialogue réel.
 *
 * Pour chaque phrase, l'agent pose la question correspondante, puis la
 * transcription passe par `recordUserTurn` (le chemin de production). On classe
 * chaque fait attendu :
 *   - correct   : la bonne valeur est retenue ;
 *   - faux      : une autre valeur est retenue sans alerte (le cas dangereux) ;
 *   - choix     : l'agent demande « X ou Y ? » (bonne valeur incluse ou non) ;
 *   - redemandé : l'agent n'a rien retenu et reposera la question.
 *
 * Usage : pnpm --filter @sokar/api exec tsx scripts/voice-stt-bench/evaluate.ts phrases.json transcripts.json
 * `VOICE_EXPECTED_ANSWER_ENABLED=false` mesure le comportement sans rapprochement phonétique.
 */
import { readFileSync } from 'node:fs';
import {
  createConversationState,
  classifyVoiceSpeechActInContext,
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

type Outcome = 'correct' | 'wrong' | 'choiceWithTruth' | 'choiceWithoutTruth' | 'reprompt';

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

function makeSession(question: string | null): CallSession {
  const session = {
    conversation: createConversationState(),
    timezone: 'Europe/Paris',
    voiceLanguageCode: 'fr',
    history: [],
  } as unknown as CallSession;
  session.conversation.intent = 'reservation';
  if (question) recordAssistantReplyFromLlmTextFallback(session, question);
  return session;
}

function main(): void {
  const [phrasesPath, transcriptsPath] = process.argv.slice(2);
  const phrases = JSON.parse(readFileSync(phrasesPath, 'utf8')) as BenchPhrase[];
  const transcripts = new Map(
    (JSON.parse(readFileSync(transcriptsPath, 'utf8')) as TranscriptResult[]).map((r) => [r.id, r]),
  );

  const tally: Record<string, Record<Outcome, number>> = {};
  const count = (fact: string, outcome: Outcome) => {
    tally[fact] ??= {
      correct: 0,
      wrong: 0,
      choiceWithTruth: 0,
      choiceWithoutTruth: 0,
      reprompt: 0,
    };
    tally[fact][outcome]++;
  };
  const wrongExamples: string[] = [];

  for (const phrase of phrases) {
    const transcript = transcripts.get(phrase.id)?.transcript ?? '';
    const session = makeSession(QUESTIONS[phrase.question]);
    if (transcript) {
      recordUserTurn(
        session,
        transcript,
        classifyVoiceSpeechActInContext(session, transcript),
        NOW,
      );
    }
    const { slots, answerChoice } = session.conversation;

    const facts: Array<[string, string | undefined, string | undefined]> = [];
    // Au-delà de 7, la réservation vocale ne retient pas le nombre (groupe) :
    // mesuré à part pour ne pas mélanger les deux comportements.
    if (phrase.expected.partySize !== undefined)
      facts.push([
        phrase.expected.partySize <= 7 ? 'personnes' : 'groupe>7',
        String(phrase.expected.partySize),
        slots.partySize?.toString(),
      ]);
    if (phrase.expected.weekday)
      facts.push(['jour', phrase.expected.weekday, slots.date ? weekdayOf(slots.date) : undefined]);
    if (phrase.expected.relativeDays !== undefined)
      facts.push(['jour', addDays(phrase.expected.relativeDays), slots.date]);
    if (phrase.expected.time) facts.push(['heure', phrase.expected.time, slots.time]);

    for (const [fact, expected, actual] of facts) {
      const choiceKind =
        fact.startsWith('personnes') || fact.startsWith('groupe')
          ? 'partySize'
          : fact === 'jour'
            ? 'weekday'
            : 'time';
      if (actual === expected) count(fact, 'correct');
      else if (actual !== undefined) {
        count(fact, 'wrong');
        wrongExamples.push(
          `${phrase.id} ${fact} attendu=${expected} obtenu=${actual} « ${transcript} »`,
        );
      } else if (answerChoice?.kind === choiceKind) {
        const normalizedExpected =
          fact === 'jour' && expected.includes('-') ? weekdayOf(expected) : expected;
        count(
          fact,
          answerChoice.values.includes(normalizedExpected)
            ? 'choiceWithTruth'
            : 'choiceWithoutTruth',
        );
      } else count(fact, 'reprompt');
    }
  }

  const pct = (value: number, total: number) =>
    `${((100 * value) / Math.max(1, total)).toFixed(0)} %`;
  for (const [fact, t] of Object.entries(tally)) {
    const total = Object.values(t).reduce((sum, value) => sum + value, 0);
    process.stdout.write(
      `${fact.padEnd(10)} n=${String(total).padStart(3)}  correct ${pct(t.correct, total).padStart(5)}  faux ${pct(t.wrong, total).padStart(4)}  ` +
        `choix(ok) ${pct(t.choiceWithTruth, total).padStart(4)}  choix(ko) ${pct(t.choiceWithoutTruth, total).padStart(4)}  redemandé ${pct(t.reprompt, total).padStart(4)}` +
        '\n',
    );
  }
  if (process.env.BENCH_VERBOSE)
    process.stdout.write(`\nValeurs fausses :\n${wrongExamples.join('\n')}\n`);
}

main();
