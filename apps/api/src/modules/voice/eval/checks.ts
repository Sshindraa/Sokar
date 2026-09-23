/**
 * Contrôles automatiques d'une conversation simulée. Fonctions pures :
 * elles ne dépendent que de la transcription et des effets enregistrés.
 */
import type { Scenario } from './scenario';

export interface TranscriptLine {
  speaker: 'caller' | 'agent';
  text: string;
}

export interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface CreatedReservation {
  date: string;
  time: string;
  partySize: number;
}

export interface EvaluationInput {
  scenario: Scenario;
  transcript: TranscriptLine[];
  toolCalls: RecordedToolCall[];
  createdReservations: CreatedReservation[];
  /** Créneaux effectivement renvoyés par la disponibilité pendant l'appel. */
  returnedSlots: string[];
  /** Heures d'ouverture et de fermeture du restaurant (HH:MM). */
  openingTimes: string[];
  /** Date du jour (YYYY-MM-DD) dans le fuseau du restaurant. */
  today: string;
  callerTurns: number;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  /** Erreur critique : réservation créée avec une date, une heure ou un nombre faux. */
  critical?: boolean;
  detail?: string;
}

const HOUR_WORDS: Record<string, number> = {
  onze: 11,
  midi: 12,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  'dix-sept': 17,
  'dix-huit': 18,
  'dix-neuf': 19,
  vingt: 20,
  'vingt et une': 21,
  'vingt-et-une': 21,
  'vingt-deux': 22,
  'vingt-trois': 23,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

const MINUTE_WORDS: Record<string, number> = {
  quinze: 15,
  trente: 30,
  'et demie': 30,
  'quarante-cinq': 45,
  'et quart': 15,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Extrait les horaires cités dans un texte (« 20 h 30 », « 20h », « 20:30 »,
 * « vingt heures trente », « 8 pm »), normalisés en HH:MM.
 */
export function extractTimes(text: string): string[] {
  const times = new Set<string>();
  const lower = text.toLocaleLowerCase('fr-FR');
  for (const match of lower.matchAll(/\b(\d{1,2})\s*(?:h|heures?)\s*(\d{2})?\b/gu)) {
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour <= 23 && minute <= 59) times.add(`${pad(hour)}:${pad(minute)}`);
  }
  // Un « 9:30 pm » est lu plus bas avec son suffixe.
  for (const match of lower.matchAll(/\b(\d{1,2}):(\d{2})\b(?!\s*(?:am|pm|a\.m\.|p\.m\.))/gu)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour <= 23 && minute <= 59) times.add(`${pad(hour)}:${pad(minute)}`);
  }
  for (const match of lower.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.m\.|a\.m\.)/gu)) {
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (match[3].startsWith('p') && hour < 12) hour += 12;
    if (hour <= 23 && minute <= 59) times.add(`${pad(hour)}:${pad(minute)}`);
  }
  const hourWords = Object.keys(HOUR_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const minuteWords = Object.keys(MINUTE_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const wordPattern = new RegExp(`\\b(${hourWords})\\s+heures?(?:\\s+(${minuteWords}))?`, 'gu');
  for (const match of lower.matchAll(wordPattern)) {
    const hour = HOUR_WORDS[match[1]];
    const minute = match[2] ? MINUTE_WORDS[match[2]] : 0;
    times.add(`${pad(hour)}:${pad(minute)}`);
  }
  return [...times];
}

/** Un horaire « 8 h » peut désigner 08:00 ou 20:00 : les deux lectures sont admises. */
function isAllowedTime(time: string, allowed: Set<string>): boolean {
  if (allowed.has(time)) return true;
  const [hour, minute] = time.split(':').map(Number);
  if (hour < 12 && allowed.has(`${pad(hour + 12)}:${pad(minute)}`)) return true;
  if (hour >= 12 && allowed.has(`${pad(hour - 12)}:${pad(minute)}`)) return true;
  return false;
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Répliques de l'agent qui refont l'accueil après le premier message. */
const GREETING_PATTERN =
  /bonjour,? ici\b|je suis son assistant virtuel|en quoi puis-je vous aider|how can i help you/iu;

export function evaluateConversation(input: EvaluationInput): CheckResult[] {
  const { scenario, transcript } = input;
  const agentLines = transcript.filter((line) => line.speaker === 'agent').map((l) => l.text);
  const callerLines = transcript.filter((line) => line.speaker === 'caller').map((l) => l.text);
  const results: CheckResult[] = [];

  // 1. Réservation attendue : créée une seule fois, avec les bonnes valeurs.
  const expectedReservation = scenario.expected.reservation;
  if (expectedReservation) {
    const expected = {
      date: addDays(input.today, expectedReservation.dateOffsetDays),
      time: expectedReservation.time,
      partySize: expectedReservation.partySize,
    };
    const wrong = input.createdReservations.filter(
      (reservation) =>
        reservation.date !== expected.date ||
        reservation.time !== expected.time ||
        reservation.partySize !== expected.partySize,
    );
    const right = input.createdReservations.length - wrong.length;
    results.push({
      name: 'reservation',
      passed: right === 1 && wrong.length === 0,
      critical: wrong.length > 0,
      detail:
        wrong.length > 0
          ? `réservation fausse : ${JSON.stringify(wrong)} au lieu de ${JSON.stringify(expected)}`
          : right === 0
            ? `aucune réservation créée (attendu ${JSON.stringify(expected)})`
            : right > 1
              ? `${right} réservations créées au lieu d'une`
              : undefined,
    });
  } else if (input.createdReservations.length > 0) {
    results.push({
      name: 'reservation',
      passed: false,
      critical: true,
      detail: `réservation créée alors qu'aucune n'était attendue : ${JSON.stringify(input.createdReservations)}`,
    });
  }

  // 2. Outils attendus et interdits.
  const called = new Set(input.toolCalls.map((call) => call.name));
  for (const tool of scenario.expected.tools) {
    results.push({
      name: `tool:${tool}`,
      passed: called.has(tool),
      detail: called.has(tool) ? undefined : `outil ${tool} jamais appelé`,
    });
  }
  for (const tool of scenario.expected.forbiddenTools) {
    results.push({
      name: `forbidden:${tool}`,
      passed: !called.has(tool),
      detail: called.has(tool) ? `outil interdit ${tool} appelé` : undefined,
    });
  }

  // 3. Aucun horaire inventé : chaque heure dite par l'agent vient de
  // l'appelant, de la disponibilité ou des horaires du restaurant.
  const allowed = new Set<string>([
    ...input.returnedSlots,
    ...input.openingTimes,
    ...callerLines.flatMap(extractTimes),
  ]);
  const invented = [
    ...new Set(agentLines.flatMap(extractTimes).filter((time) => !isAllowedTime(time, allowed))),
  ];
  results.push({
    name: 'no_invented_time',
    passed: invented.length === 0,
    detail: invented.length ? `horaires sans source : ${invented.join(', ')}` : undefined,
  });

  // 4. Nombre de tours.
  results.push({
    name: 'turns',
    passed: input.callerTurns <= scenario.expected.maxTurns,
    detail:
      input.callerTurns > scenario.expected.maxTurns
        ? `${input.callerTurns} tours pour ${scenario.expected.maxTurns} maximum`
        : undefined,
  });

  // 5. Aucune répétition de l'accueil après la première réplique.
  const repeated = agentLines.slice(1).filter((line) => GREETING_PATTERN.test(line));
  results.push({
    name: 'no_greeting_repeat',
    passed: repeated.length === 0,
    detail: repeated.length ? `accueil répété : « ${repeated[0]} »` : undefined,
  });

  // 6. Contenu attendu ou interdit (réplique après l'accueil).
  const spokenAfterGreeting = agentLines.slice(1);
  for (const pattern of scenario.expected.mustSay) {
    const regex = new RegExp(pattern, 'iu');
    const found = spokenAfterGreeting.some((line) => regex.test(line));
    results.push({
      name: `must_say:${pattern}`,
      passed: found,
      detail: found ? undefined : `aucune réplique ne correspond à /${pattern}/`,
    });
  }
  for (const pattern of scenario.expected.mustNotSay) {
    const regex = new RegExp(pattern, 'iu');
    const offending = spokenAfterGreeting.find((line) => regex.test(line));
    results.push({
      name: `must_not_say:${pattern}`,
      passed: !offending,
      detail: offending ? `réplique interdite : « ${offending} »` : undefined,
    });
  }

  return results;
}
