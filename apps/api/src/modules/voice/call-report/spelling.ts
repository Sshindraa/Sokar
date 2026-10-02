/**
 * Épellation répartie sur plusieurs tours : le direct coupe la parole de l'appelant au milieu de ses
 * lettres, et chaque fragment devient un tour (« a » puis « a 2 s » puis « m »). C'est le terrain où
 * une lettre se perd ou se recolle.
 */
import { tokenize } from './tokens';

export interface SplitSpelling {
  turnIds: string[];
  texts: string[];
}

/** Tour fait uniquement de jetons d'un seul caractère, dont au moins une lettre. */
function isLettersOnly(text: string): boolean {
  const tokens = tokenize(text);
  return (
    tokens.length > 0 &&
    tokens.every((token) => token.length === 1) &&
    tokens.some((token) => /\p{L}/u.test(token))
  );
}

export function findSplitSpellings(
  turns: ReadonlyArray<{ turnId: string; callerText: string | null }>,
): SplitSpelling[] {
  const result: SplitSpelling[] = [];
  let current: SplitSpelling | null = null;
  for (const turn of turns) {
    const text = (turn.callerText ?? '').trim();
    if (!text) continue;
    if (isLettersOnly(text)) {
      if (!current) {
        current = { turnIds: [], texts: [] };
        result.push(current);
      }
      current.turnIds.push(turn.turnId);
      current.texts.push(text);
    } else {
      current = null;
    }
  }
  return result.filter((spelling) => spelling.turnIds.length >= 2);
}
