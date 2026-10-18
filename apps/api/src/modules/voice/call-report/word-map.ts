/**
 * Rattache le texte du direct (par tour) aux mots horodatés d'une piste : c'est ce qui place un tour,
 * une divergence ou une relecture sur la ligne de temps de l'enregistrement, sans dépendre de
 * l'horloge du serveur.
 */
import { alignTokens } from './align';
import { tokenize } from './tokens';
import type { TranscribedWord } from './deepgram-batch';

export interface FlatWords {
  tokens: string[];
  /** Pour chaque jeton, l'indice du mot de la piste dont il vient. */
  wordOf: number[];
}

export function flattenWords(words: readonly { text: string }[]): FlatWords {
  const tokens: string[] = [];
  const wordOf: number[] = [];
  words.forEach((word, index) => {
    for (const token of tokenize(word.text)) {
      tokens.push(token);
      wordOf.push(index);
    }
  });
  return { tokens, wordOf };
}

/** Indice du mot de la piste pour chaque jeton du direct, ou null si la piste ne l'a pas entendu. */
export function mapTokensToWords(
  liveTokens: readonly string[],
  flat: FlatWords,
): Array<number | null> {
  const map: Array<number | null> = liveTokens.map(() => null);
  for (const op of alignTokens(liveTokens, flat.tokens)) {
    if (op.type === 'match' || op.type === 'sub') map[op.refIndex] = flat.wordOf[op.hypIndex];
  }
  return map;
}

export interface Span {
  start: number;
  end: number;
}

/** Début de la première parole et fin de la dernière pour les jetons [from, to[. */
export function spanOfTokens(
  map: ReadonlyArray<number | null>,
  words: readonly TranscribedWord[],
  from: number,
  to: number,
): Span | null {
  const indexes = map.slice(from, to).filter((value): value is number => value !== null);
  if (indexes.length === 0) return null;
  return {
    start: Math.min(...indexes.map((index) => words[index].start)),
    end: Math.max(...indexes.map((index) => words[index].end)),
  };
}

/** Instant (début de mot) d'un jeton ; un jeton perdu prend le mot voisin le plus proche. */
export function timeOfToken(
  map: ReadonlyArray<number | null>,
  words: readonly TranscribedWord[],
  tokenIndex: number,
): number | null {
  for (let distance = 0; distance < map.length; distance++) {
    for (const index of [tokenIndex - distance, tokenIndex + distance]) {
      const wordIndex = map[index];
      if (wordIndex !== undefined && wordIndex !== null) return words[wordIndex].start;
    }
  }
  return null;
}

/**
 * Texte de la piste pour chaque tour : un mot revient au tour dont la parole est la plus proche, la
 * frontière étant à mi-chemin entre deux prises de parole. Les mots avant le premier tour et après le
 * dernier lui reviennent. Un tour qu'on n'a pas pu placer sur la piste reçoit un texte vide.
 *
 * C'est ce qui rend comparables les oreilles : chacune est lue sur le même morceau d'audio, quel que
 * soit le découpage des mots.
 */
export function zoneTexts(
  spans: ReadonlyArray<Span | null>,
  words: readonly TranscribedWord[],
): string[] {
  const placed = spans
    .map((span, index) => ({ span, index }))
    .filter((entry): entry is { span: Span; index: number } => entry.span !== null)
    .sort((a, b) => a.span.start - b.span.start);
  const texts: string[][] = spans.map(() => []);
  if (placed.length === 0) return texts.map(() => '');

  const limits = placed
    .slice(0, -1)
    .map(
      (entry, i) =>
        (Math.min(entry.span.end, placed[i + 1].span.start) + placed[i + 1].span.start) / 2,
    );
  for (const word of words) {
    const at = (word.start + word.end) / 2;
    let zone = limits.findIndex((limit) => at < limit);
    if (zone < 0) zone = placed.length - 1;
    texts[placed[zone].index].push(word.text);
  }
  return texts.map((list) => list.join(' '));
}
