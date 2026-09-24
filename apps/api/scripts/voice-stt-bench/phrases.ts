/**
 * Banc STT vocal — génération déterministe des phrases et des valeurs attendues.
 *
 * Deux jeux séparés :
 *   - `calibration` (graine 20260924, 4 voix) : sert uniquement à régler les
 *     seuils de `EXPECTED_ANSWER_THRESHOLDS` ; ses transcriptions du 24/09
 *     sont réutilisées ;
 *   - `validation` (autre graine, voix réservées incluses) : seuls ses chiffres
 *     sont rapportés. Il contient des réponses hors sujet et des paires pièges.
 *
 * Chaque phrase simule la réponse d'un appelant à une question de l'agent
 * (`question`). Les voix de synthèse sont plus propres que de vrais appelants :
 * le banc compare des variantes, il n'annonce pas un taux de production.
 *
 * Usage : pnpm --filter @sokar/api exec tsx scripts/voice-stt-bench/phrases.ts validation > .data/validation-phrases.json
 */

export type BenchSet = 'calibration' | 'validation' | 'hard-calibration' | 'hard-validation';
export type BenchQuestion = 'partySize' | 'date' | 'time' | 'open';

export interface BenchPhrase {
  id: string;
  question: BenchQuestion;
  text: string;
  expected: {
    partySize?: number;
    weekday?: string;
    relativeDays?: number;
    time?: string;
    /** Réponse hors sujet : aucune valeur ne doit être retenue ni proposée. */
    offTopic?: boolean;
  };
  voice: string;
  /** Débit de synthèse accéléré (niveau « difficile »). */
  speed?: 'fast';
  /** Rapport signal/bruit en dB et taux de paquets perdus appliqués à l'audio. */
  snrDb: number;
  packetLoss: number;
}

export const CALIBRATION_VOICES = [
  'd9f4af15-c402-4f50-bbda-d8823d028d6a', // Henri, masculin, naturel
  '3b7d569e-01fc-45ef-b74b-29460956c691', // Josette, féminin
  '9d216805-e52e-4b1e-966a-6447df592a5d', // Fabien, masculin, naturel
  '63fdecc2-4e1d-4aa3-a442-27204e3cd3b5', // Léonie, féminin
] as const;

/** Voix jamais utilisées en calibration. */
export const VALIDATION_ONLY_VOICES = [
  'c6ccfe32-6bee-484a-a8a2-7a51bee93f99', // Étienne, masculin
  '7c58f4a4-a72c-42fa-a503-41b9408820f3', // Inès, féminin
] as const;

/** Voix réservées à la validation « difficile » (jamais en calibration). */
export const HARD_VALIDATION_ONLY_VOICES = [
  '996ec149-0dca-4389-ad08-e2d6f906b4bf', // Mathis, masculin
  '92579402-6868-412e-b845-3efed0be7a9e', // Jade, féminin
] as const;

const SEEDS: Record<BenchSet, number> = {
  calibration: 20260924,
  validation: 20261001,
  'hard-calibration': 20261101,
  'hard-validation': 20261115,
};

const NUMBER_WORDS = [
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

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const HOURS: Record<number, string> = {
  12: 'midi',
  13: 'treize heures',
  19: 'dix-neuf heures',
  20: 'vingt heures',
  21: 'vingt et une heures',
  22: 'vingt-deux heures',
};

const OFF_TOPIC_ANSWERS = [
  'C’est pour un anniversaire.',
  'Je sais pas encore.',
  'Allô ?',
  'Allô, vous m’entendez ?',
  'Attendez, je demande à ma femme.',
  'Je voudrais parler au responsable.',
  'Vous avez une terrasse ?',
  'C’est possible de venir avec un chien ?',
  'Vous faites des plats végétariens ?',
  'Je rappellerai plus tard.',
  'Excusez-moi, je n’ai pas compris.',
  'Il y a un parking à côté ?',
  'Je peux payer en chèque vacances ?',
  'C’est à quel nom déjà ?',
  'Oui bonjour.',
  'Un instant s’il vous plaît.',
  'Bon, écoutez, on verra.',
  'C’est pour un repas d’affaires.',
  'Je suis en voiture, pardon.',
  'Mon mari s’occupe de ça d’habitude.',
];

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spokenTime(hour: number, minute: number): string {
  const base = HOURS[hour];
  if (hour === 12) return minute === 30 ? 'midi et demi' : minute === 15 ? 'midi et quart' : 'midi';
  if (minute === 0) return base;
  if (minute === 30) return `${base} trente`;
  if (minute === 15) return `${base} quinze`;
  return `${base} quarante-cinq`;
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function partySizePhrases(n: number): string[] {
  const word = NUMBER_WORDS[n];
  const people = n === 1 ? 'une personne' : `${word} personnes`;
  return [
    `${capitalize(people)}.`,
    `Euh, ${people}.`,
    `On sera ${word}.`,
    `Pour ${word}, s’il vous plaît.`,
    `Nous serons ${people}.`,
  ];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Draft = Omit<BenchPhrase, 'id' | 'voice' | 'snrDb' | 'packetLoss'>;

/** Jeu du 24/09 : ne pas modifier, ses transcriptions sont réutilisées. */
function calibrationDrafts(random: () => number): Draft[] {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const phrases: Draft[] = [];
  for (let n = 2; n <= 12; n++) {
    const forms = partySizePhrases(n);
    for (let k = 0; k < 3; k++)
      phrases.push({ question: 'partySize', text: pick(forms), expected: { partySize: n } });
  }
  for (const n of [6, 10, 2, 12, 3, 7]) {
    phrases.push({
      question: 'partySize',
      text: `${capitalize(NUMBER_WORDS[n])}.`,
      expected: { partySize: n },
    });
  }
  for (const day of WEEKDAYS) {
    phrases.push({ question: 'date', text: `${capitalize(day)}.`, expected: { weekday: day } });
    phrases.push({
      question: 'date',
      text: `Pour ${day} soir, s’il vous plaît.`,
      expected: { weekday: day },
    });
    phrases.push({
      question: 'date',
      text: `Euh, plutôt ${day} midi.`,
      expected: { weekday: day },
    });
  }
  phrases.push({ question: 'date', text: 'Demain soir.', expected: { relativeDays: 1 } });
  phrases.push({ question: 'date', text: 'Ce soir, si possible.', expected: { relativeDays: 0 } });
  phrases.push({ question: 'date', text: 'Après-demain.', expected: { relativeDays: 2 } });
  const times: Array<[number, number]> = [
    [12, 0],
    [12, 30],
    [19, 0],
    [19, 30],
    [19, 15],
    [20, 0],
    [20, 30],
    [20, 15],
    [21, 0],
    [21, 30],
    [22, 0],
    [22, 30],
    [20, 45],
    [19, 45],
  ];
  for (const [hour, minute] of times) {
    const spoken = spokenTime(hour, minute);
    phrases.push({
      question: 'time',
      text: `${capitalize(spoken)}.`,
      expected: { time: hhmm(hour, minute) },
    });
    phrases.push({
      question: 'time',
      text: `Vers ${spoken}, s’il vous plaît.`,
      expected: { time: hhmm(hour, minute) },
    });
  }
  for (let k = 0; k < 20; k++) {
    const n = 2 + Math.floor(random() * 7);
    const day = pick(WEEKDAYS);
    const [hour, minute] = pick(times.filter(([h]) => h !== 12));
    phrases.push({
      question: 'open',
      text: `Bonjour, je voudrais une table pour ${NUMBER_WORDS[n]} personnes ${day} à ${spokenTime(hour, minute)}.`,
      expected: { partySize: n, weekday: day, time: hhmm(hour, minute) },
    });
  }
  return phrases;
}

function validationDrafts(random: () => number): Draft[] {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const phrases: Draft[] = [];

  // Nombre de personnes : 1 à 7 (réservables), quatre formulations par valeur.
  for (let n = 1; n <= 7; n++) {
    const forms = partySizePhrases(n);
    for (let k = 0; k < 6; k++)
      phrases.push({ question: 'partySize', text: pick(forms), expected: { partySize: n } });
  }
  // Paires pièges : six/dix, deux/douze, trois/treize, seize/six.
  for (const n of [6, 10, 2, 12, 3, 13, 16, 6, 10, 2, 12, 3, 13, 16]) {
    phrases.push({
      question: 'partySize',
      text: pick(partySizePhrases(n)),
      expected: { partySize: n },
    });
    phrases.push({
      question: 'partySize',
      text: `${capitalize(NUMBER_WORDS[n])}.`,
      expected: { partySize: n },
    });
  }

  // Jour : formulations variées, jours relatifs.
  for (const day of WEEKDAYS) {
    for (const form of [
      `${capitalize(day)}.`,
      `Ce ${day}, si possible.`,
      `Euh, ${day} soir.`,
      `Plutôt ${day} midi.`,
      `On pensait à ${day}.`,
      `Pour ${day}, s’il vous plaît.`,
      `${capitalize(day)} prochain.`,
      `Ah, ${day} ce serait bien.`,
      `Euh, ${day}.`,
    ]) {
      phrases.push({ question: 'date', text: form, expected: { weekday: day } });
    }
  }
  for (const [text, relativeDays] of [
    ['Demain.', 1],
    ['Demain midi.', 1],
    ['Ce soir.', 0],
    ['Aujourd’hui, si c’est possible.', 0],
    ['Après-demain soir.', 2],
  ] as const) {
    phrases.push({ question: 'date', text, expected: { relativeDays } });
  }

  // Heure, dont les paires pièges vingt/vingt-deux heures et huit/vingt heures.
  const times: Array<[number, number]> = [
    [12, 0],
    [12, 15],
    [12, 30],
    [13, 0],
    [19, 0],
    [19, 15],
    [19, 30],
    [19, 45],
    [20, 0],
    [20, 15],
    [20, 30],
    [20, 45],
    [21, 0],
    [21, 15],
    [21, 30],
    [22, 0],
    [22, 30],
  ];
  for (const [hour, minute] of times) {
    const spoken = spokenTime(hour, minute);
    for (const form of [
      `${capitalize(spoken)}.`,
      `Vers ${spoken}.`,
      `Euh, plutôt ${spoken}.`,
      `À ${spoken}, s’il vous plaît.`,
    ]) {
      phrases.push({ question: 'time', text: form, expected: { time: hhmm(hour, minute) } });
    }
  }
  for (const [text, time] of [
    ['Vingt heures.', '20:00'],
    ['Vingt-deux heures.', '22:00'],
    ['Vers vingt heures, s’il vous plaît.', '20:00'],
    ['Vers vingt-deux heures, s’il vous plaît.', '22:00'],
    ['Huit heures du soir.', '20:00'],
    ['Vers huit heures ce soir.', '20:00'],
    ['Vingt heures pile.', '20:00'],
    ['Vingt-deux heures pile.', '22:00'],
  ] as const) {
    phrases.push({ question: 'time', text, expected: { time } });
  }

  // Réponses hors sujet, posées à chaque type de question.
  const offTopicQuestions: BenchQuestion[] = ['partySize', 'date', 'time'];
  for (const text of OFF_TOPIC_ANSWERS) {
    for (const question of offTopicQuestions) {
      phrases.push({ question, text, expected: { offTopic: true } });
    }
  }

  // Demandes complètes.
  for (let k = 0; k < 30; k++) {
    const n = 1 + Math.floor(random() * 7);
    const day = pick(WEEKDAYS);
    const [hour, minute] = pick(times);
    const people = n === 1 ? 'une personne' : `${NUMBER_WORDS[n]} personnes`;
    phrases.push({
      question: 'open',
      text: `Bonsoir, une table pour ${people} ${day} à ${spokenTime(hour, minute)}, c’est possible ?`,
      expected: { partySize: n, weekday: day, time: hhmm(hour, minute) },
    });
  }
  return phrases;
}

/**
 * Demandes à plusieurs valeurs, dont l'heure donnée en premier
 * (« À vingt heures pour quatre personnes »).
 */
function multiValueDrafts(random: () => number): Draft[] {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const times: Array<[number, number]> = [
    [19, 30],
    [20, 0],
    [20, 15],
    [20, 30],
    [21, 0],
    [21, 15],
    [21, 30],
    [22, 0],
    [22, 30],
  ];
  const phrases: Draft[] = [];
  for (let k = 0; k < 40; k++) {
    const n = 1 + Math.floor(random() * 7);
    const [hour, minute] = pick(times);
    const time = hhmm(hour, minute);
    const spoken = spokenTime(hour, minute);
    const people = n === 1 ? 'une personne' : `${NUMBER_WORDS[n]} personnes`;
    const day = pick(WEEKDAYS);
    const forms: Draft[] = [
      { question: 'open', text: `À ${spoken} pour ${people}.`, expected: { partySize: n, time } },
      {
        question: 'open',
        text: `Vers ${spoken}, on sera ${NUMBER_WORDS[n]}.`,
        expected: { partySize: n, time },
      },
      {
        question: 'open',
        text: `${capitalize(day)} à ${spoken}, pour ${people}.`,
        expected: { partySize: n, weekday: day, time },
      },
    ];
    phrases.push(pick(forms));
  }
  return phrases;
}

export function buildBenchPhrases(set: BenchSet = 'calibration'): BenchPhrase[] {
  const random = seeded(SEEDS[set]);
  const hard = set.startsWith('hard-');
  const drafts =
    set === 'calibration'
      ? calibrationDrafts(random)
      : hard
        ? [...validationDrafts(random), ...multiValueDrafts(random)]
        : validationDrafts(random);
  const voices =
    set === 'calibration' || set === 'hard-calibration'
      ? [...CALIBRATION_VOICES]
      : set === 'hard-validation'
        ? [...HARD_VALIDATION_ONLY_VOICES, ...VALIDATION_ONLY_VOICES, ...CALIBRATION_VOICES]
        : [...VALIDATION_ONLY_VOICES, ...CALIBRATION_VOICES];
  const prefix = {
    calibration: 'p',
    validation: 'v',
    'hard-calibration': 'hc',
    'hard-validation': 'hv',
  }[set];
  return drafts.map((phrase, index) => ({
    ...phrase,
    id: `${prefix}${String(index + 1).padStart(3, '0')}`,
    voice: voices[index % voices.length],
    // Niveau difficile : bruit fort (5–10 dB), 3–5 % de paquets perdus, une
    // phrase sur deux au débit rapide, pour que Scribe se trompe assez souvent.
    ...(hard && random() < 0.5 ? { speed: 'fast' as const } : {}),
    snrDb: hard ? Math.round(5 + random() * 5) : Math.round(15 + random() * 15),
    packetLoss: hard ? Math.round(30 + random() * 20) / 1000 : Math.round(random() * 30) / 1000,
  }));
}

if (process.argv[1]?.endsWith('phrases.ts')) {
  const set = (process.argv[2] ?? 'calibration') as BenchSet;
  process.stdout.write(`${JSON.stringify(buildBenchPhrases(set), null, 2)}\n`);
}
