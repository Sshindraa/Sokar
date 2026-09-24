/**
 * Banc STT vocal — génération déterministe des phrases et des valeurs attendues.
 *
 * Chaque phrase simule la réponse d'un appelant à une question de l'agent
 * (`question`) et porte les faits qu'une réservation doit en retirer. Le banc
 * compare des variantes entre elles ; les voix de synthèse sont plus propres
 * que de vrais appelants, les taux absolus ne sont donc pas ceux de la prod.
 *
 * Usage : pnpm --filter @sokar/api exec tsx scripts/voice-stt-bench/phrases.ts > phrases.json
 */

export type BenchQuestion = 'partySize' | 'date' | 'time' | 'open';

export interface BenchPhrase {
  id: string;
  question: BenchQuestion;
  text: string;
  expected: { partySize?: number; weekday?: string; relativeDays?: number; time?: string };
  voice: string;
  /** Rapport signal/bruit en dB et taux de paquets perdus appliqués à l'audio. */
  snrDb: number;
  packetLoss: number;
}

export const BENCH_VOICES = [
  'd9f4af15-c402-4f50-bbda-d8823d028d6a', // Henri, masculin, naturel
  '3b7d569e-01fc-45ef-b74b-29460956c691', // Josette, féminin
  '9d216805-e52e-4b1e-966a-6447df592a5d', // Fabien, masculin, naturel
  '63fdecc2-4e1d-4aa3-a442-27204e3cd3b5', // Léonie, féminin
] as const;

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
];

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const HOURS: Record<number, string> = {
  12: 'midi',
  19: 'dix-neuf heures',
  20: 'vingt heures',
  21: 'vingt et une heures',
  22: 'vingt-deux heures',
};

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

export function buildBenchPhrases(seed = 20260924): BenchPhrase[] {
  const random = seeded(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const phrases: Omit<BenchPhrase, 'id' | 'voice' | 'snrDb' | 'packetLoss'>[] = [];

  // Nombre de personnes : 2 à 12, deux formulations tirées au sort par valeur,
  // plus les valeurs faciles à confondre au téléphone (six/dix, deux/douze…).
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

  // Jour : jours de semaine, avec ou sans moment de la journée, et relatifs.
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

  // Heure : services du midi et du soir, formes parlées usuelles.
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
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    phrases.push({ question: 'time', text: `${capitalize(spoken)}.`, expected: { time } });
    phrases.push({
      question: 'time',
      text: `Vers ${spoken}, s’il vous plaît.`,
      expected: { time },
    });
  }

  // Demandes complètes dites d'une traite.
  for (let k = 0; k < 20; k++) {
    const n = 2 + Math.floor(random() * 7);
    const day = pick(WEEKDAYS);
    const [hour, minute] = pick(times.filter(([h]) => h !== 12));
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    phrases.push({
      question: 'open',
      text: `Bonjour, je voudrais une table pour ${NUMBER_WORDS[n]} personnes ${day} à ${spokenTime(hour, minute)}.`,
      expected: { partySize: n, weekday: day, time },
    });
  }

  return phrases.map((phrase, index) => ({
    ...phrase,
    id: `p${String(index + 1).padStart(3, '0')}`,
    voice: BENCH_VOICES[index % BENCH_VOICES.length],
    snrDb: Math.round(15 + random() * 15),
    packetLoss: Math.round(random() * 30) / 1000,
  }));
}

if (process.argv[1]?.endsWith('phrases.ts')) {
  process.stdout.write(`${JSON.stringify(buildBenchPhrases(), null, 2)}\n`);
}
