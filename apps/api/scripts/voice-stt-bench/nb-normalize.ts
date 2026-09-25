/**
 * Banc narrowband (phase 1) — normalisation FR pour le scoring.
 *
 * Unifie chiffres et lettres pour que « quatre personnes », « 4 personnes » et
 * « quatre » comparent la même chose : minuscules, accents retirés, ponctuation
 * supprimée, nombres écrits en chiffres, lettres épelées recollées, heures
 * ramenées à `HH:MM`. Sert au WER et à la vérification des informations
 * critiques (chiffres, heures, noms, téléphone).
 */

const UNITS: Record<string, number> = {
  zero: 0,
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
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};

const TENS: Record<string, number> = {
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

/** Parse une fenêtre de tokens comme un seul nombre, ou `null` si incomplet. */
function parseNumberTokens(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  const [first, ...rest] = tokens;

  if (first === 'quatre' && rest[0] === 'vingt') {
    const after = rest.slice(1);
    if (after[0] === 'dix') {
      const tail = after.slice(1);
      if (tail.length === 0) return 90;
      const unit = parseNumberTokens(tail);
      return unit !== null && unit >= 1 && unit <= 9 ? 90 + unit : null;
    }
    if (after.length === 0) return 80;
    const unit = parseNumberTokens(after);
    return unit !== null && unit >= 1 && unit <= 9 ? 80 + unit : null;
  }

  if (first === 'dix' && rest.length === 1) {
    const unit = UNITS[rest[0]];
    if (unit !== undefined && unit >= 7 && unit <= 9) return 10 + unit;
  }

  if (TENS[first] !== undefined) {
    const base = TENS[first];
    if (rest.length === 0) return base;
    if (rest[0] === 'et') {
      const unit = parseNumberTokens(rest.slice(1));
      return unit !== null && unit >= 1 && unit <= 9 ? base + unit : null;
    }
    if (base === 60 && rest[0] === 'dix') {
      const tail = rest.slice(1);
      if (tail.length === 0) return 70;
      const unit = parseNumberTokens(tail);
      return unit !== null && unit >= 1 && unit <= 6 ? 70 + unit : null;
    }
    const unit = parseNumberTokens(rest);
    return unit !== null && unit >= 1 && unit <= 9 ? base + unit : null;
  }

  if (UNITS[first] !== undefined && rest.length === 0) return UNITS[first];
  return null;
}

function stripAccents(value: string): string {
  return value
    .replace(/œ/gu, 'oe')
    .replace(/æ/gu, 'ae')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** tokens bruts : minuscules, sans accents, apostrophes et tirets éclatés. */
function rawTokens(text: string): string[] {
  return stripAccents(text.toLocaleLowerCase('fr-FR'))
    .replace(/[’']/gu, ' ')
    .replace(/[-–—]/gu, ' ')
    .replace(/[^a-z0-9:]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

/** Une suite de ≥ 3 lettres isolées est une épellation : on la recolle. */
function joinSpelledLetters(tokens: string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < tokens.length; ) {
    if (/^[a-z]$/u.test(tokens[index])) {
      let end = index;
      while (end < tokens.length && /^[a-z]$/u.test(tokens[end])) end++;
      if (end - index >= 3) {
        output.push(tokens.slice(index, end).join(''));
        index = end;
        continue;
      }
    }
    output.push(tokens[index]);
    index++;
  }
  return output;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

const HOUR_WORDS = new Set(['h', 'heure', 'heures']);
const EVENING_CUES = new Set(['soir', 'soiree']);
const AFTERNOON_CUES = new Set(['apres', 'midi', 'midis']);

/** Ramène les heures parlées (`vingt heures trente`, `19h45`) à `HH:MM`. */
function normalizeTimes(tokens: string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    // Forme collée : « 19h45 », « 19h ».
    const fused = /^(\d{1,2})h(\d{2})?$/u.exec(token);
    if (fused) {
      const hour = Number(fused[1]);
      const minute = fused[2] ? Number(fused[2]) : 0;
      output.push(`${pad(hour)}:${pad(minute)}`);
      continue;
    }

    const hour = /^\d{1,2}$/u.test(token) ? Number(token) : null;
    const next = tokens[index + 1];
    if (hour !== null && next && HOUR_WORDS.has(next)) {
      let minute: number | null = null;
      let cursor = index + 2;
      if (
        tokens[cursor] === 'et' &&
        (tokens[cursor + 1] === 'demi' || tokens[cursor + 1] === 'demie')
      ) {
        minute = 30;
        cursor += 2;
      } else if (tokens[cursor] === 'et' && tokens[cursor + 1] === 'quart') {
        minute = 15;
        cursor += 2;
      } else if (tokens[cursor] === 'trente') {
        minute = 30;
        cursor += 1;
      } else if (tokens[cursor] === 'quinze') {
        minute = 15;
        cursor += 1;
      } else if (tokens[cursor] === 'quarante' && tokens[cursor + 1] === 'cinq') {
        minute = 45;
        cursor += 2;
      } else if (/^\d{1,2}$/u.test(tokens[cursor] ?? '')) {
        minute = Number(tokens[cursor]);
        cursor += 1;
      }
      let resolved = hour;
      const cue = tokens[cursor];
      const cue2 = tokens[cursor + 1];
      if (resolved < 12 && cue === 'du' && cue2 && EVENING_CUES.has(cue2)) resolved += 12;
      if (
        resolved < 12 &&
        cue === 'de' &&
        cue2 === 'l' &&
        AFTERNOON_CUES.has(tokens[cursor + 2] ?? '')
      )
        resolved += 12;
      output.push(`${pad(resolved)}:${pad(minute ?? 0)}`);
      index = cursor - 1;
      continue;
    }

    if (token === 'midi') {
      if (
        tokens[index + 1] === 'et' &&
        (tokens[index + 2] === 'demi' || tokens[index + 2] === 'demie')
      ) {
        output.push('12:30');
        index += 2;
      } else if (tokens[index + 1] === 'et' && tokens[index + 2] === 'quart') {
        output.push('12:15');
        index += 2;
      } else {
        output.push('12:00');
      }
      continue;
    }

    output.push(token);
  }
  return output;
}

/** tokens normalisés : nombres en chiffres, épellations recollées, heures en `HH:MM`. */
export function normalizeTokens(text: string): string[] {
  const tokens = joinSpelledLetters(rawTokens(text));
  const mapped: string[] = [];
  for (let index = 0; index < tokens.length; ) {
    let matched = false;
    for (let width = Math.min(4, tokens.length - index); width >= 1; width--) {
      const value = parseNumberTokens(tokens.slice(index, index + width));
      if (value !== null) {
        mapped.push(String(value));
        index += width;
        matched = true;
        break;
      }
    }
    if (!matched) {
      mapped.push(tokens[index]);
      index++;
    }
  }
  return normalizeTimes(mapped);
}

/** Texte canonique (WER) : tokens normalisés recollés par un espace. */
export function normalizeText(text: string): string {
  return normalizeTokens(text).join(' ');
}

/** True when a normalized multi-token value occurs contiguously in a transcript. */
export function containsNormalizedPhrase(transcript: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalizeText(transcript)} `.includes(` ${normalizedPhrase} `);
}

/** Tous les nombres du transcript, dans l'ordre, concaténés (téléphone). */
export function digitSequence(text: string): string {
  return normalizeTokens(text)
    .filter((token) => /^\d+$/u.test(token))
    .join('');
}

/** Distance de Levenshtein sur les tokens. */
export function tokenEditDistance(reference: string[], hypothesis: string[]): number {
  const rows = reference.length;
  const columns = hypothesis.length;
  let previous = Array.from({ length: columns + 1 }, (_, index) => index);
  for (let row = 1; row <= rows; row++) {
    const current = new Array<number>(columns + 1);
    current[0] = row;
    for (let column = 1; column <= columns; column++) {
      const cost = reference[row - 1] === hypothesis[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[columns];
}

export interface WerResult {
  /** Distance d'édition divisée par la longueur de la référence (peut dépasser 1). */
  wer: number;
  distance: number;
  referenceLength: number;
}

export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const refTokens = normalizeTokens(reference);
  const hypTokens = normalizeTokens(hypothesis);
  const distance = tokenEditDistance(refTokens, hypTokens);
  return {
    wer: refTokens.length === 0 ? 0 : distance / refTokens.length,
    distance,
    referenceLength: refTokens.length,
  };
}
