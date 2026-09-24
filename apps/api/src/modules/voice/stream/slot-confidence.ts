/**
 * Confirmation guidée par la confiance.
 *
 * Le rapprochement phonétique (`expected-answer.ts`) ne voit pas les erreurs
 * les plus dangereuses : un mot propre mais faux, que l'analyse exacte accepte
 * (« dix » transcrit « six », « vingt-deux heures » transcrit « 20h »). Ce module
 * les repère avec les signaux déjà disponibles — confiance Scribe des mots qui
 * portent la valeur, stabilité des transcriptions partielles, voisins
 * confusables — et décide s'il faut confirmer. Il ne dépend pas de la session :
 * le contrôleur lui fournit les valeurs et applique la décision.
 */

export type ConfidenceSlotKind = 'partySize' | 'weekday' | 'time';
export type SlotConfidenceDecision = 'readBack' | 'choice' | 'reprompt';

export interface SlotWord {
  word: string;
  confidence?: number;
}

/**
 * Seuils réglés sur le banc « difficile », jeu de calibration uniquement (24/09) :
 * au téléphone, Scribe donne des confiances basses même aux mots justes, d'où
 * des valeurs bien plus faibles qu'attendu.
 */
export const SLOT_CONFIDENCE_THRESHOLDS = {
  /** En dessous, une valeur qui a un voisin confusable est proposée en choix. */
  low: 0.25,
  /** En dessous, une valeur sans voisin est redemandée. */
  veryLow: 0.1,
};

/** Paires que le téléphone confond : « six/dix/seize », « deux/douze »… */
const PARTY_SIZE_NEIGHBOURS: Record<number, number[]> = {
  2: [12],
  3: [13],
  5: [7],
  6: [10, 16],
  7: [5],
  10: [6],
  12: [2],
  13: [3],
  16: [6],
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 20 h / 21 h / 22 h, 8 h / 20 h, « et quart » / « et demie ». */
function timeNeighbours(time: string): string[] {
  const [hour, minute] = time.split(':').map(Number);
  const neighbours = new Set<string>();
  const hourNeighbours: Record<number, number[]> = {
    20: [21, 22, 8],
    21: [20, 22, 9],
    22: [20, 21, 10],
    8: [20],
    9: [21],
    10: [22],
  };
  for (const other of hourNeighbours[hour] ?? []) neighbours.add(`${pad(other)}:${pad(minute)}`);
  if (minute === 15) neighbours.add(`${pad(hour)}:30`);
  if (minute === 30) neighbours.add(`${pad(hour)}:15`);
  return [...neighbours];
}

export function confusableNeighbours(kind: ConfidenceSlotKind, value: string): string[] {
  if (kind === 'partySize') return (PARTY_SIZE_NEIGHBOURS[Number(value)] ?? []).map(String);
  if (kind === 'time') return timeNeighbours(value);
  return [];
}

const FRENCH_NUMBER_WORDS: Record<number, string[]> = {
  1: ['un', 'une'],
  2: ['deux'],
  3: ['trois'],
  4: ['quatre'],
  5: ['cinq'],
  6: ['six'],
  7: ['sept'],
  8: ['huit'],
  9: ['neuf'],
  10: ['dix'],
  11: ['onze'],
  12: ['douze', 'midi'],
  13: ['treize'],
  14: ['quatorze'],
  15: ['quinze', 'quart'],
  16: ['seize'],
  19: ['dix', 'neuf'],
  20: ['vingt'],
  21: ['vingt', 'et', 'un', 'une'],
  22: ['vingt', 'deux'],
  30: ['trente', 'demie', 'demi'],
  45: ['quarante', 'cinq'],
};

function normalizeWord(word: string): string {
  return word
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Formes écrites que Scribe peut produire pour la valeur (« 20h », « vingt », « 20:15 »…). */
function valueTokens(kind: ConfidenceSlotKind, value: string): (token: string) => boolean {
  if (kind === 'weekday') {
    return (token) => token === value || token === 'demain' || token === 'aujourdhui';
  }
  if (kind === 'partySize') {
    const n = Number(value);
    const words = new Set([String(n), ...(FRENCH_NUMBER_WORDS[n] ?? [])]);
    return (token) => words.has(token);
  }
  const [hour, minute] = value.split(':').map(Number);
  const words = new Set([
    String(hour),
    String(hour % 12 || 12),
    ...(FRENCH_NUMBER_WORDS[hour] ?? []),
    ...(FRENCH_NUMBER_WORDS[hour % 12 || 12] ?? []),
    ...(minute ? [String(minute), pad(minute), ...(FRENCH_NUMBER_WORDS[minute] ?? [])] : []),
  ]);
  // « 20h », « 20h15 », « 20:15 » : un seul mot Scribe porte toute l'heure.
  return (token) => words.has(token) || new RegExp(`^${hour}h?\\d{0,2}$`).test(token);
}

/**
 * Confiance des mots qui portent la valeur : la plus faible d'entre eux, car
 * une seule syllabe mal entendue suffit à changer « vingt-deux » en « vingt ».
 * `null` quand Scribe n'a pas fourni de confiance ou qu'aucun mot ne correspond.
 */
export function valueConfidence(
  kind: ConfidenceSlotKind,
  value: string,
  words: readonly SlotWord[] | undefined,
): number | null {
  if (!words?.length) return null;
  const matches = valueTokens(kind, value);
  const confidences = words
    .filter((word) => matches(normalizeWord(word.word)))
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return confidences.length ? Math.min(...confidences) : null;
}

/**
 * Valeurs lues dans les transcriptions partielles du tour et différentes de la
 * valeur finale (« six » → « dix » → « six »). La première sert de voisin.
 */
export function unstableAlternatives(
  finalValue: string,
  partialValues: readonly (string | undefined)[],
): string[] {
  return [...new Set(partialValues.filter((v): v is string => Boolean(v) && v !== finalValue))];
}

export interface SlotConfidenceInput {
  kind: ConfidenceSlotKind;
  value: string;
  confidence: number | null;
  partialAlternatives: string[];
  /** Heures ouvertes du jour concerné ; absentes si inconnues. */
  openTimes?: readonly string[];
  thresholds?: typeof SLOT_CONFIDENCE_THRESHOLDS;
}

export interface SlotConfidenceResult {
  decision: SlotConfidenceDecision;
  /** Pour un choix : la valeur retenue puis le voisin proposé. */
  choice?: [string, string];
  unstable: boolean;
  outsideOpeningHours: boolean;
}

export function decideSlotConfidence(input: SlotConfidenceInput): SlotConfidenceResult {
  const thresholds = input.thresholds ?? SLOT_CONFIDENCE_THRESHOLDS;
  const unstable = input.partialAlternatives.length > 0;
  const openTimes = input.openTimes?.length ? input.openTimes : undefined;
  const outsideOpeningHours =
    input.kind === 'time' && Boolean(openTimes) && !openTimes!.includes(input.value);

  // Voisins plausibles : ceux vus dans les partielles d'abord, puis la table ;
  // pour une heure, seulement ceux qui tombent dans les horaires d'ouverture.
  const plausible = [
    ...input.partialAlternatives,
    ...confusableNeighbours(input.kind, input.value),
  ].filter((candidate, index, all) => {
    if (candidate === input.value || all.indexOf(candidate) !== index) return false;
    return input.kind !== 'time' || !openTimes || openTimes.includes(candidate);
  });
  const neighbour = plausible[0];

  // Une heure hors des horaires d'ouverture n'est jamais acceptée d'office.
  if (outsideOpeningHours) {
    return neighbour
      ? { decision: 'choice', choice: [input.value, neighbour], unstable, outsideOpeningHours }
      : { decision: 'reprompt', unstable, outsideOpeningHours };
  }

  const confidence = input.confidence;
  const low = confidence !== null && confidence < thresholds.low;
  if ((low || unstable) && neighbour) {
    return { decision: 'choice', choice: [input.value, neighbour], unstable, outsideOpeningHours };
  }
  if (confidence !== null && confidence < thresholds.veryLow && !neighbour) {
    return { decision: 'reprompt', unstable, outsideOpeningHours };
  }
  return { decision: 'readBack', unstable, outsideOpeningHours };
}
