/**
 * Interprétation d'une réponse attendue par rapprochement phonétique.
 *
 * Quand l'agent pose une question fermée (nombre de personnes, jour, heure),
 * les réponses possibles forment une liste courte. Au téléphone (8 kHz), le STT
 * confond des sons voisins : « six personnes » devient « super femme ». Au lieu
 * de conclure « pas compris », on compare la prononciation approximative de la
 * transcription à celle de chaque réponse possible, avec un coût réduit pour
 * les confusions typiques du téléphone, et on classe les candidats.
 *
 * La phonétisation est volontairement simple : elle ne vise que ce vocabulaire
 * fermé, pas le français en général.
 */

export type ExpectedAnswerKind = 'partySize' | 'weekday' | 'time';

export interface ExpectedAnswerCandidate {
  /** Valeur canonique : nombre de personnes, jour (« samedi ») ou heure « HH:MM ». */
  value: string;
  /** Coût d'alignement normalisé : 0 = identique, 1 = rien en commun. */
  score: number;
}

export type ExpectedAnswerDecision =
  | { status: 'accepted'; value: string; candidates: ExpectedAnswerCandidate[] }
  | { status: 'choice'; values: [string, string]; candidates: ExpectedAnswerCandidate[] }
  | { status: 'unresolved'; candidates: ExpectedAnswerCandidate[] };

const NUMBER_WORDS: Record<number, string> = {
  0: 'zero',
  1: 'un',
  2: 'deux',
  3: 'trois',
  4: 'quatre',
  5: 'cinq',
  6: 'six',
  7: 'sept',
  8: 'huit',
  9: 'neuf',
  10: 'dix',
  11: 'onze',
  12: 'douze',
  13: 'treize',
  14: 'quatorze',
  15: 'quinze',
  16: 'seize',
  17: 'dix sept',
  18: 'dix huit',
  19: 'dix neuf',
  20: 'vingt',
  21: 'vingt et un',
  22: 'vingt deux',
  23: 'vingt trois',
  30: 'trente',
  45: 'quarante cinq',
};

export const WEEKDAY_NAMES = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;

/** Nombre de personnes proposé au rapprochement (au-delà : groupe, géré ailleurs). */
const MAX_PARTY_SIZE = 16;

// ─── Normalisation ──────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLocaleLowerCase('fr-FR')
    .replace(/[éèêë]/g, (char) => (char === 'é' ? '§' : 'è'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/§/g, 'é')
    .replace(/[’']/g, ' ')
    .replace(/(\d{1,2})\s*h\s*(\d{2})/g, (_, h: string, m: string) => ` ${h} heures ${m} `)
    .replace(/(\d{1,2})\s*h\b/g, (_, h: string) => ` ${h} heures `)
    .replace(/\d{1,2}/g, (digits) => ` ${NUMBER_WORDS[Number(digits)] ?? digits} `)
    .replace(/[^a-zé§è\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Phonétisation approximative ────────────────────────────────────────────
// Alphabet : voyelles a e E(è) @(schwa) i o u y(u français) 5(in) A(an) O(on)
// consonnes usuelles, S(ch) Z(j) N(gn).

const VOWELS = new Set(['a', 'e', 'E', '@', 'i', 'o', 'u', 'y', '5', 'A', 'O']);

function wordToPhonemes(rawWord: string): string {
  // Exceptions fréquentes du vocabulaire de réservation.
  const exceptions: Record<string, string> = {
    six: 'sis',
    dix: 'dis',
    huit: 'yit',
    sept: 'sEt',
    cinq: 's5k',
    neuf: 'n@f',
    vingt: 'v5',
    et: 'e',
    est: 'E',
    un: '5',
    une: 'yn',
    heure: '@r',
    heures: '@r',
    femme: 'fam',
    femmes: 'fam',
    monsieur: 'm@sj@',
  };
  if (exceptions[rawWord]) return exceptions[rawWord];

  // 1. Terminaisons : -er/-ez/-et → é, puis consonnes finales muettes.
  let word = rawWord.replace(/(er|ez|et)$/u, 'é');
  if (word.length > 2) word = word.replace(/(ent|[stdxzp])$/u, '');

  // 2. Graphies composées.
  const rules: Array<[RegExp, string]> = [
    [/eau/g, 'o'],
    [/au/g, 'o'],
    [/ai|ei/g, 'è'],
    [/oi/g, 'wa'],
    [/ou/g, 'U'],
    [/eu/g, 'ø'],
    [/ch/g, 'S'],
    [/gn/g, 'N'],
    [/ph/g, 'f'],
    [/qu/g, 'k'],
    [/gu(?=[eiéè])/g, 'g'],
    [/c(?=[eiyéè])/g, 's'],
    [/ç/g, 's'],
    [/g(?=[eiyéè])/g, 'Z'],
    [/j/g, 'Z'],
    [/c/g, 'k'],
    [/h/g, ''],
    [/x/g, 'ks'],
    [/w/g, 'v'],
  ];
  for (const [pattern, replacement] of rules) word = word.replace(pattern, replacement);

  // 3. Voyelles nasales : devant une consonne autre que n/m, ou en fin de mot
  //    (« personne » garde un o oral, « trente » un an nasal).
  word = word
    .replace(/(?:ain|ein|in|im|yn)(?=[^aeiouyéèUønm]|$)/g, '5')
    .replace(/(?:un|um)(?=[^aeiouyéèUønm]|$)/g, '5')
    .replace(/(?:an|am|en|em)(?=[^aeiouyéèUønm]|$)/g, 'A')
    .replace(/(?:on|om)(?=[^aeiouyéèUønm]|$)/g, 'O');

  // 4. Consonnes doublées, s entre deux voyelles, e muet final.
  word = word.replace(/([bdfgklmnprstvzSZ])\1/g, '$1');
  word = word.replace(/(?<=[aeiouyéèUø])s(?=[aeiouyéèUø])/g, 'z');
  if (word.length > 2) word = word.replace(/e$/u, '');

  // 5. Voyelles : u → y (u français), ou → u, eu → ø ≈ schwa, é → e, è → E.
  return word
    .replace(/u/g, 'y')
    .replace(/U/g, 'u')
    .replace(/ø/g, '@')
    .replace(/é/g, 'e')
    .replace(/è/g, 'E')
    .replace(/e(?=[^aeiouyAEO5@]|$)/g, '@')
    .replace(/[^a-zA-Z5@]/g, '');
}

function phonemize(text: string): string {
  return normalize(text).split(' ').filter(Boolean).map(wordToPhonemes).join('');
}

export function toPhonemes(text: string): string {
  return phonemize(text);
}

// ─── Distance pondérée ──────────────────────────────────────────────────────

const CONFUSABLE_GROUPS: Array<[string, number]> = [
  ['sfSz', 0.35], // fricatives : le téléphone coupe au-dessus de 3,4 kHz
  ['iy', 0.3],
  ['eE@', 0.25],
  ['mnN', 0.3],
  ['pb', 0.4],
  ['td', 0.4],
  ['kg', 0.4],
  ['vf', 0.45],
  ['ao', 0.5],
  ['oO', 0.4],
  ['aA', 0.4],
  ['5AO', 0.45],
  ['uo', 0.45],
  ['yu', 0.4],
];

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  for (const [group, cost] of CONFUSABLE_GROUPS) {
    if (group.includes(a) && group.includes(b)) return cost;
  }
  const bothVowels = VOWELS.has(a) && VOWELS.has(b);
  const bothConsonants = !VOWELS.has(a) && !VOWELS.has(b);
  return bothVowels ? 0.75 : bothConsonants ? 0.85 : 1;
}

function indelCost(phoneme: string): number {
  return phoneme === '@' || phoneme === 'r' || phoneme === 'l' ? 0.5 : 1;
}

/**
 * Alignement semi-global : le candidat doit être entièrement aligné, mais il
 * peut correspondre à n'importe quelle portion de la transcription
 * (« euh, pour super femme » contient la réponse au milieu).
 */
function alignmentCost(candidate: string, transcript: string, anchored: boolean): number {
  const rows = candidate.length + 1;
  const cols = transcript.length + 1;
  // Ancré : le candidat doit couvrir toute la transcription (formes courtes
  // comme « six », qui sinon se retrouveraient dans n'importe quel mot).
  let previous = Array.from({ length: cols }, (_, j) =>
    anchored ? [...transcript.slice(0, j)].reduce((sum, p) => sum + indelCost(p), 0) : 0,
  );
  for (let i = 1; i < rows; i++) {
    const current = new Array<number>(cols);
    current[0] = previous[0] + indelCost(candidate[i - 1]);
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(
        previous[j] + indelCost(candidate[i - 1]),
        current[j - 1] + indelCost(transcript[j - 1]),
        previous[j - 1] + substitutionCost(candidate[i - 1], transcript[j - 1]),
      );
    }
    previous = current;
  }
  return anchored ? previous[cols - 1] : Math.min(...previous);
}

/** Une forme de moins de 5 sons n'est comparée qu'à la réponse entière. */
const MIN_UNANCHORED_LENGTH = 5;

/** Mots d'hésitation et de politesse retirés avant une comparaison ancrée. */
const FILLER_PATTERN =
  /\b(?:euh|heu|hum|ben|bah|alors|donc|oui|ok|d accord|s il vous plait|s il te plait|merci|plutot|voila)\b/g;

// ─── Candidats ──────────────────────────────────────────────────────────────

function partySizeForms(n: number): string[] {
  // « une » est aussi un article (« on sera une petite tablée ») : une seule
  // personne n'est reconnue que sous la forme « une personne ».
  if (n === 1) return ['une personne', 'une seule personne'];
  const word = NUMBER_WORDS[n];
  return [`${word} personnes`, `pour ${word}`, `on sera ${word}`, `nous serons ${word}`, word];
}

function spokenMinutes(minute: number): string[] {
  if (minute === 0) return [''];
  if (minute === 30) return ['trente', 'et demie'];
  if (minute === 15) return ['quinze', 'et quart'];
  if (minute === 45) return ['quarante cinq'];
  return [NUMBER_WORDS[minute] ?? String(minute)];
}

function timeForms(time: string): string[] {
  const [hour, minute] = time.split(':').map(Number);
  const hourWords = hour === 12 ? ['midi', 'douze heures'] : [`${NUMBER_WORDS[hour]} heures`];
  return hourWords.flatMap((h) =>
    spokenMinutes(minute).map((m) =>
      h === 'midi' && m === 'et demie' ? 'midi et demi' : `${h} ${m}`.trim(),
    ),
  );
}

interface CandidateSource {
  value: string;
  forms: string[];
}

function candidatesFor(
  kind: ExpectedAnswerKind,
  allowedValues?: readonly string[],
): CandidateSource[] {
  if (kind === 'partySize') {
    return Array.from({ length: MAX_PARTY_SIZE }, (_, index) => index + 1).map((n) => ({
      value: String(n),
      forms: partySizeForms(n),
    }));
  }
  if (kind === 'weekday') return WEEKDAY_NAMES.map((day) => ({ value: day, forms: [day] }));
  const times =
    allowedValues && allowedValues.length > 0
      ? allowedValues
      : ['12', '13', '19', '20', '21', '22'].flatMap((h) =>
          ['00', '15', '30', '45'].map((m) => `${h}:${m}`),
        );
  return times.map((time) => ({ value: time, forms: timeForms(time) }));
}

export function rankExpectedAnswers(
  transcript: string,
  kind: ExpectedAnswerKind,
  allowedValues?: readonly string[],
): ExpectedAnswerCandidate[] {
  const heard = phonemize(transcript);
  if (!heard) return [];
  const heardCore = phonemize(normalize(transcript).replace(FILLER_PATTERN, ' '));
  return candidatesFor(kind, allowedValues)
    .map(({ value, forms }) => ({
      value,
      score: Math.min(
        ...forms.map((form) => {
          const expected = phonemize(form);
          if (!expected) return 1;
          const anchored = expected.length < MIN_UNANCHORED_LENGTH;
          const target = anchored ? heardCore || heard : heard;
          return (
            alignmentCost(expected, target, anchored) /
            Math.max(expected.length, anchored ? target.length : 0)
          );
        }),
      ),
    }))
    .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value));
}

/** Seuils calibrés sur le banc STT (scripts/voice-stt-bench). */
export const EXPECTED_ANSWER_THRESHOLDS = {
  /** Au-delà, aucun candidat n'est assez proche pour être proposé. */
  maxScore: 0.4,
  /** Écart minimal entre les deux premiers candidats pour accepter sans demander. */
  minMargin: 0.12,
  /** Au-delà, même un candidat isolé est proposé en choix plutôt qu'accepté. */
  maxAcceptScore: 0.25,
};

/**
 * Indice que la phrase répond bien à la question posée : un mot du domaine
 * (« personne », « heure »…) ou une réponse très courte. Sans lui, une phrase
 * hors sujet peut ressembler à une réponse (« c'est pour ce soir » ≈ « pour six »).
 */
const ANSWER_CUE: Record<ExpectedAnswerKind, RegExp> = {
  partySize: /\b(?:personnes?|person|personen|couverts?|people)\b/,
  weekday: /\b(?:pour|plutot|ce|le)\b/,
  time: /\b(?:heures?|h|vers|a)\b/,
};
const SHORT_ANSWER_WORDS = 3;
const SHORT_ANSWER_MAX_SCORE = 0.2;

export function resolveExpectedAnswer(
  transcript: string,
  kind: ExpectedAnswerKind,
  allowedValues?: readonly string[],
  thresholds = EXPECTED_ANSWER_THRESHOLDS,
): ExpectedAnswerDecision {
  const candidates = rankExpectedAnswers(transcript, kind, allowedValues);
  const [best, second] = candidates;
  if (!best || best.score > thresholds.maxScore) return { status: 'unresolved', candidates };
  const normalized = normalize(transcript);
  const shortAnswer =
    normalized.replace(FILLER_PATTERN, ' ').trim().split(/\s+/).length <= SHORT_ANSWER_WORDS;
  const hasCue = ANSWER_CUE[kind].test(normalized);
  if (!hasCue && !(shortAnswer && best.score <= SHORT_ANSWER_MAX_SCORE)) {
    return { status: 'unresolved', candidates };
  }
  // Une correspondance phonétique parfaite est retenue : la relecture dans la
  // phrase suivante couvre le cas d'un mot voisin mal entendu (« dix » → « six »).
  const exactMatch = best.score === 0 && (!second || second.score > 0);
  const clearLead = exactMatch || !second || second.score - best.score >= thresholds.minMargin;
  if (clearLead && best.score <= thresholds.maxAcceptScore) {
    return { status: 'accepted', value: best.value, candidates };
  }
  if (!second) return { status: 'unresolved', candidates };
  return { status: 'choice', values: [best.value, second.value], candidates };
}
