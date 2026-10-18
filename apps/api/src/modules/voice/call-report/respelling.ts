/**
 * Erreur d'oreille systématique probable : l'agent relit des lettres, l'appelant ne valide pas et
 * épelle de nouveau, et la suite de lettres transcrite est **identique** à celle qui vient d'être
 * relue. Si la transcription était juste, la relecture aurait été acceptée ; que la même suite
 * revienne telle quelle dit que le moteur entend deux fois la même chose, contre ce que l'appelant dit.
 *
 * Comparaison de suites de lettres uniquement : jetons d'un seul caractère, dans l'ordre. Aucune liste
 * de mots (le refus n'est pas lu dans « non » : c'est la nouvelle épellation qui le montre).
 */
import { tokenize } from './tokens';

export interface Respelling {
  /** La suite de lettres (et chiffres, « a 2 s ») transcrite, identique les deux fois. */
  letters: string[];
  /** Le tour de la réponse de l'agent qui reprenait ces lettres. */
  readbackTurnId: string;
  readbackText: string;
  firstTurnIds: string[];
  /** Les tours de la nouvelle épellation, identique. */
  secondTurnIds: string[];
}

interface Attempt {
  letters: string[];
  turnIds: string[];
  /** Réponse de l'agent qui a clos la tentative, avec son tour. */
  reply: { turnId: string; text: string } | null;
  readback: boolean;
}

const MIN_LETTERS = 3;
const isLetter = (token: string): boolean => /^\p{L}$/u.test(token);

/** Les jetons d'un seul caractère d'un tour, s'ils forment de l'épellation (au moins deux, dont une lettre). */
function spelledTokens(text: string): string[] {
  const singles = tokenize(text).filter((token) => token.length === 1);
  return singles.length >= 2 && singles.some(isLetter) ? singles : [];
}

/** Une réponse reprend les lettres si elle contient au moins une des lettres épelées, seule. */
function repeatsLetters(replyText: string, letters: readonly string[]): boolean {
  const spelled = new Set(letters.filter(isLetter));
  return tokenize(replyText).some((token) => isLetter(token) && spelled.has(token));
}

export function findIdenticalRespellings(
  rows: ReadonlyArray<{ turnId: string; callerText: string | null; agentText: string | null }>,
): Respelling[] {
  const attempts: Attempt[] = [];
  let current: Attempt | null = null;
  for (const row of rows) {
    const spelled = spelledTokens(row.callerText ?? '');
    if (spelled.length > 0) {
      current ??= { letters: [], turnIds: [], reply: null, readback: false };
      current.letters.push(...spelled);
      current.turnIds.push(row.turnId);
    }
    const reply = (row.agentText ?? '').trim();
    if (current && reply) {
      current.reply = { turnId: row.turnId, text: reply };
      current.readback = repeatsLetters(reply, current.letters);
      attempts.push(current);
      current = null;
    }
  }
  if (current) attempts.push(current);

  const found: Respelling[] = [];
  attempts.forEach((later, laterIndex) => {
    if (later.letters.length < MIN_LETTERS) return;
    const key = later.letters.join(' ');
    // Une relecture n'est « refusée » que si une autre épellation vient après elle.
    const refused = attempts
      .slice(0, laterIndex)
      .find((earlier) => earlier.readback && earlier.letters.join(' ') === key);
    if (!refused?.reply) return;
    found.push({
      letters: later.letters,
      readbackTurnId: refused.reply.turnId,
      readbackText: refused.reply.text,
      firstTurnIds: refused.turnIds,
      secondTurnIds: later.turnIds,
    });
  });
  return found;
}
