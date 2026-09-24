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
  buildAvailabilityReplyPlan,
  buildDeterministicTurnPlan,
  buildReservationProgressPlan,
  classifyVoiceSpeechActInContext,
  createConversationState,
  getReadyAvailabilityRequest,
  recordAssistantReplyFromLlmTextFallback,
  recordUserTurn,
} from '../../src/modules/voice/stream/conversation-controller';
import {
  SLOT_CONFIDENCE_THRESHOLDS,
  valueConfidence,
} from '../../src/modules/voice/stream/slot-confidence';
import type { CallSession } from '../../src/modules/voice/stream/types';
import type { BenchPhrase } from './phrases';

interface TranscriptResult {
  id: string;
  transcript: string;
  /** Mots Scribe avec log-probabilité (banc « difficile » et suivants). */
  words?: Array<{ word: string; logprob: number | null }>;
  partials?: string[];
  error: string | null;
}

/** Restaurant du banc : ouvert tous les jours de 12 h à 23 h. */
const BENCH_OPENING_HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    { open: '12:00', close: '23:00' },
  ]),
) as NonNullable<CallSession['openingHours']>;

type Outcome =
  | 'correct'
  | 'wrongReadBack'
  | 'wrongSilent'
  | 'choiceOk'
  | 'choiceKo'
  | 'reprompt'
  | 'uselessConfirm';
/** Issues exclusives ; `uselessConfirm` est compté à part (sous-ensemble des choix/redemandes). */
const OUTCOMES: Outcome[] = [
  'correct',
  'wrongReadBack',
  'wrongSilent',
  'choiceOk',
  'choiceKo',
  'reprompt',
];

const FRENCH_NUMBERS = [
  '',
  'une',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
];

/**
 * Réponse suivante de l'agent par le chemin déterministe de production :
 * plan du tour (choix, relances…), sinon réponse de disponibilité si la demande
 * est complète (créneau supposé libre), sinon question suivante. Une chaîne
 * vide signifie que le LLM répondrait : la valeur n'est alors pas relue.
 */
function nextAgentReply(
  session: CallSession,
  transcript: string,
  speechAct: ReturnType<typeof classifyVoiceSpeechActInContext>,
): string {
  const turnPlan = buildDeterministicTurnPlan(session, speechAct, transcript);
  if (turnPlan) return turnPlan.reply;
  const request = getReadyAvailabilityRequest(session);
  if (request) return buildAvailabilityReplyPlan(session, request, [request.time]).reply;
  return buildReservationProgressPlan(session, transcript)?.reply ?? '';
}

/** La valeur retenue est-elle prononcée dans la réponse suivante ? */
function isSpoken(reply: string, kind: 'partySize' | 'weekday' | 'time', value: string): boolean {
  const text = reply
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  if (kind === 'weekday') return new RegExp(`\\b${value}\\b`).test(text);
  if (kind === 'partySize') {
    const n = Number(value);
    const word = n === 1 ? '(?:une|1) personne' : `(?:${FRENCH_NUMBERS[n] ?? n}|${n}) personnes`;
    return new RegExp(`\\b${word}\\b`).test(text);
  }
  const [hour, minute] = value.split(':').map(Number);
  const spoken = minute === 0 ? `${hour} h` : `${hour} h ${String(minute).padStart(2, '0')}`;
  return (
    new RegExp(`\\b${spoken}(?!\\s*\\d)`).test(text) || (value === '12:00' && /\bmidi\b/.test(text))
  );
}

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

/**
 * AUROC : probabilité qu'une valeur juste ait une confiance plus haute qu'une
 * valeur fausse (0,5 = le hasard, 1 = séparation parfaite).
 */
function auroc(scores: Array<{ confidence: number | null; correct: boolean }>): number | null {
  const known = scores.filter((s) => s.confidence !== null) as Array<{
    confidence: number;
    correct: boolean;
  }>;
  const right = known.filter((s) => s.correct).map((s) => s.confidence);
  const wrong = known.filter((s) => !s.correct).map((s) => s.confidence);
  if (!right.length || !wrong.length) return null;
  let wins = 0;
  for (const r of right) for (const w of wrong) wins += r > w ? 1 : r === w ? 0.5 : 0;
  return wins / (right.length * wrong.length);
}

function makeSession(question: string | null): CallSession {
  const session = {
    conversation: createConversationState(),
    restaurantId: 'bench-restaurant',
    openingHours: BENCH_OPENING_HOURS,
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
  /** Issue par phrase et par fait, pour repérer les confirmations inutiles. */
  outcomes: Map<string, Outcome>;
  /** Confiance Scribe de chaque valeur retenue, et si elle était juste (AUROC). */
  scores: Record<string, Array<{ confidence: number | null; correct: boolean }>>;
}

function evaluate(phrases: BenchPhrase[], transcripts: Map<string, TranscriptResult>): Evaluation {
  const tally: Record<string, Record<Outcome, number>> = {};
  const details: string[] = [];
  const outcomes = new Map<string, Outcome>();
  const scores: Evaluation['scores'] = {};
  let currentPhrase = '';
  const count = (fact: string, outcome: Outcome) => {
    outcomes.set(`${currentPhrase}|${fact}`, outcome);
    tally[fact] ??= {
      correct: 0,
      wrongReadBack: 0,
      wrongSilent: 0,
      choiceOk: 0,
      choiceKo: 0,
      reprompt: 0,
      uselessConfirm: 0,
    };
    tally[fact][outcome]++;
  };

  for (const phrase of phrases) {
    currentPhrase = phrase.id;
    const result = transcripts.get(phrase.id);
    const transcript = result?.transcript ?? '';
    const session = makeSession(QUESTIONS[phrase.question]);
    session.sttEvidence = {
      transcript,
      words: result?.words?.map((word) => ({
        word: word.word,
        ...(typeof word.logprob === 'number' ? { confidence: Math.exp(word.logprob) } : {}),
      })),
      partials: result?.partials ?? [],
    };
    const before = { ...session.conversation.slots };
    let reply = '';
    if (transcript) {
      const speechAct = classifyVoiceSpeechActInContext(session, transcript);
      recordUserTurn(session, transcript, speechAct, NOW);
      reply = nextAgentReply(session, transcript, speechAct);
    }
    const { slots, answerChoice } = session.conversation;

    if (phrase.expected.offTopic) {
      const retained = (['partySize', 'date', 'time'] as const).find(
        (slot) => slots[slot] !== undefined && slots[slot] !== before[slot],
      );
      if (retained) {
        count('hors sujet', 'wrongSilent');
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
      if (actual !== undefined) {
        (scores[fact] ??= []).push({
          confidence: valueConfidence(choiceKind, actual, session.sttEvidence?.words),
          correct: actual === expected,
        });
      }
      if (actual === expected) count(fact, 'correct');
      else if (actual !== undefined) {
        const readBack = isSpoken(reply, choiceKind, actual);
        count(fact, readBack ? 'wrongReadBack' : 'wrongSilent');
        const confidence = valueConfidence(choiceKind, actual, session.sttEvidence?.words);
        details.push(
          `${readBack ? 'relu' : 'SILENCIEUX'} ${fact} ${phrase.id} « ${phrase.text} » → « ${transcript} » → confiance ${confidence === null ? '?' : confidence.toFixed(2)} → ${actual} (attendu ${expected}) ; agent : « ${reply} »`,
        );
      } else if (answerChoice?.kind === choiceKind) {
        count(fact, answerChoice.values.includes(expected) ? 'choiceOk' : 'choiceKo');
      } else count(fact, 'reprompt');
    }
  }
  return { tally, details, outcomes, scores };
}

/** Rapprochement de la phase 1 toujours actif ; seul le flag de confiance bascule. */
function withFlag<T>(enabled: boolean, run: () => T): T {
  const keys = ['VOICE_EXPECTED_ANSWER_ENABLED', 'VOICE_CONFIDENCE_CONFIRM_ENABLED'] as const;
  const previous = keys.map((key) => process.env[key]);
  process.env.VOICE_EXPECTED_ANSWER_ENABLED = 'true';
  process.env.VOICE_CONFIDENCE_CONFIRM_ENABLED = enabled ? 'true' : 'false';
  try {
    return run();
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}

function main(): void {
  // Réglage des seuils (jeu de calibration uniquement) : BENCH_THRESHOLDS=bas,très-bas
  if (process.env.BENCH_THRESHOLDS) {
    const [low, veryLow] = process.env.BENCH_THRESHOLDS.split(',').map(Number);
    Object.assign(SLOT_CONFIDENCE_THRESHOLDS, { low, veryLow });
  }
  const [phrasesPath, transcriptsPath] = process.argv.slice(2);
  const phrases = JSON.parse(readFileSync(phrasesPath, 'utf8')) as BenchPhrase[];
  const transcripts = new Map(
    (JSON.parse(readFileSync(transcriptsPath, 'utf8')) as TranscriptResult[]).map((r) => [r.id, r]),
  );
  const pct = (value: number) => `${(100 * value).toFixed(0)} %`;
  const run = (subset: BenchPhrase[]) => {
    const results = {
      off: withFlag(false, () => evaluate(subset, transcripts)),
      on: withFlag(true, () => evaluate(subset, transcripts)),
    };
    // Confirmation inutile : flag actif demande (choix ou redemande) alors que,
    // flag coupé, la bonne valeur était retenue.
    for (const [key, onOutcome] of results.on.outcomes) {
      const offOutcome = results.off.outcomes.get(key);
      if (offOutcome === 'correct' && ['choiceOk', 'choiceKo', 'reprompt'].includes(onOutcome)) {
        results.on.tally[key.split('|')[1]].uselessConfirm++;
      }
    }
    return results;
  };
  const table = (title: string, results: ReturnType<typeof run>, n: number) => {
    lines.push(
      '',
      `${title} (N = ${n} phrases)`,
      '| Type | Flag confiance | n | correct [IC 95 %] | wrongReadBack | wrongSilent [IC 95 %] | choix ok | choix ko | redemandé | confirmations inutiles |',
      '|---|---|---|---|---|---|---|---|---|---|',
    );
    const types = [
      ...new Set([...Object.keys(results.off.tally), ...Object.keys(results.on.tally)]),
    ];
    for (const type of types) {
      for (const flag of ['off', 'on'] as const) {
        const t = results[flag].tally[type];
        if (!t) continue;
        const total = OUTCOMES.reduce((sum, outcome) => sum + t[outcome], 0);
        const [cLow, cHigh] = wilson(t.correct, total);
        const [sLow, sHigh] = wilson(t.wrongSilent, total);
        lines.push(
          `| ${type} | ${flag === 'on' ? 'actif' : 'coupé'} | ${total} | ${t.correct} (${pct(t.correct / total)}) [${pct(cLow)}–${pct(cHigh)}] | ` +
            `${t.wrongReadBack} (${pct(t.wrongReadBack / total)}) | ` +
            `${t.wrongSilent} (${pct(t.wrongSilent / total)}) [${pct(sLow)}–${pct(sHigh)}] | ${t.choiceOk} | ${t.choiceKo} | ${t.reprompt} | ` +
            `${flag === 'on' ? t.uselessConfirm : '—'} |`,
        );
      }
    }
  };

  const lines: string[] = [];
  const results = run(phrases);
  table('Toutes les phrases', results, phrases.length);
  const heard = phrases.filter((phrase) => transcripts.get(phrase.id)?.transcript.trim());
  table('Hors transcriptions vides', run(heard), heard.length);

  // AUROC mesurée flag coupé : les valeurs retenues n'y sont pas filtrées.
  lines.push(
    '',
    '| Type | valeurs retenues | fausses | sans confiance | AUROC |',
    '|---|---|---|---|---|',
  );
  for (const [type, scores] of Object.entries(results.off.scores)) {
    const value = auroc(scores);
    lines.push(
      `| ${type} | ${scores.length} | ${scores.filter((s) => !s.correct).length} | ` +
        `${scores.filter((s) => s.confidence === null).length} | ${value === null ? '—' : value.toFixed(2)} |`,
    );
  }

  // Transcriptions vides selon la dégradation appliquée (bruit, puis pertes).
  const emptyRate = (label: string, keyOf: (phrase: BenchPhrase) => number) => {
    lines.push('', `| ${label} | phrases | vides |`, '|---|---|---|');
    const buckets = new Map<number, { total: number; empty: number }>();
    for (const phrase of phrases) {
      const bucket = buckets.get(keyOf(phrase)) ?? { total: 0, empty: 0 };
      bucket.total++;
      if (!transcripts.get(phrase.id)?.transcript.trim()) bucket.empty++;
      buckets.set(keyOf(phrase), bucket);
    }
    for (const [key, { total, empty }] of [...buckets].sort(([a], [b]) => a - b)) {
      lines.push(`| ${key} | ${total} | ${empty} (${pct(empty / total)}) |`);
    }
  };
  emptyRate('SNR (dB)', (phrase) => phrase.snrDb);
  emptyRate('Pertes de paquets (%)', (phrase) => Math.round(phrase.packetLoss * 100));

  if (process.env.BENCH_VERBOSE) {
    lines.push('', 'Cas wrong et faux positifs, flag coupé :', ...results.off.details);
    lines.push('', 'Cas wrong et faux positifs, flag actif :', ...results.on.details);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
