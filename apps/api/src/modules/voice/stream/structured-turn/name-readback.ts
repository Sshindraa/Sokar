/**
 * Relecture du nom lettre par lettre : le code calcule les lettres, le modèle formule autour, le code vérifie la
 * structure avant de parler.
 *
 * Appel 8043662c : le modèle a relu « Assamm, avec deux s et deux m », que la voix lit « deux secondes et deux
 * mètres ». La relecture est la seule protection contre une erreur de reconnaissance : elle doit être celle des
 * lettres du brouillon, chacune isolée et dans l'ordre. Une lettre isolée est lue comme une lettre par la voix
 * (vérifié en synthèse réelle, HTTP et WebSocket, sur des noms à lettres doublées) ; une lettre suivie d'un nombre
 * ou d'un mot (« deux s », « s et m ») ne l'est pas.
 *
 * Aucune phrase, aucun mot : les lettres sont des données (lettre, nombre de répétitions de suite) et le contrôle
 * est structurel (jetons d'une seule lettre, dans l'ordre).
 */

export interface NameLetter {
  letter: string;
  /** Nombre de fois que la lettre s'écrit de suite (2 pour un « SS »). */
  count: number;
}

const stripToLetters = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}]/gu, '')
    .toLocaleUpperCase('fr-FR');

/** Les lettres du nom, une par une (tous les mots, sans accent, en majuscules). */
export function nameLetterSequence(name: string): string {
  return stripToLetters(name);
}

/** Les lettres du nom en données : chaque lettre et le nombre de fois qu'elle s'écrit de suite. */
export function nameLettersData(name: string): NameLetter[] {
  const letters = nameLetterSequence(name);
  const runs: NameLetter[] = [];
  for (const letter of letters) {
    const last = runs.at(-1);
    if (last && last.letter === letter) last.count += 1;
    else runs.push({ letter, count: 1 });
  }
  return runs;
}

const SEPARATORS = /[\s,.;:!?…()«»"“”]+/u;

/** Les jetons de la phrase qui sont une seule lettre, ou null pour tout autre jeton, dans l'ordre. */
function isolatedLetterTokens(say: string): Array<string | null> {
  return say
    .split(SEPARATORS)
    .filter(Boolean)
    .map((token) => (/^\p{L}$/u.test(token) ? stripToLetters(token) : null));
}

/**
 * Chaque lettre du nom apparaît isolée et dans l'ordre dans la phrase : une suite de jetons d'une seule lettre,
 * consécutifs, qui épelle exactement le nom. Faux pour « Assamm, avec deux s et deux m » (aucune lettre isolée),
 * pour « A, deux S, A, M » (une lettre doublée écrite une seule fois) et pour un nom lu comme un mot.
 */
export function sayReadsLetters(say: string, name: string): boolean {
  const expected = nameLetterSequence(name);
  if (!expected) return false;
  const tokens = isolatedLetterTokens(say);
  for (let start = 0; start + expected.length <= tokens.length; start++) {
    let matches = true;
    for (let offset = 0; offset < expected.length; offset++) {
      if (tokens[start + offset] !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/** Les lettres seules, séparées par des virgules : dernier recours quand la phrase du modèle ne les porte pas. */
export function lettersOnly(name: string): string | null {
  const letters = nameLetterSequence(name);
  return letters ? [...letters].join(', ') : null;
}

/**
 * La consigne de relecture, donnée au second passage et par `spelledNameFact` : les lettres du nom retenu en
 * données, et la forme à respecter. Aucun exemple de phrase.
 */
export function readbackInstruction(name: string): string {
  return (
    `Les lettres du nom retenu, en données (« count » : nombre de fois que la lettre s'écrit de suite) : ` +
    `${JSON.stringify(nameLettersData(name))}. ` +
    `Relis uniquement ce nom en écrivant ses lettres une à une, isolées et dans l'ordre, chaque lettre autant de fois ` +
    `que son « count » ; ne dis jamais le nom comme un mot, ne décris jamais sa graphie ; puis demande si c'est ` +
    `bien ça (awaiting=customerNameConfirmation).`
  );
}

/** Fait du second passage quand la phrase du modèle ne porte pas les lettres du nom retenu : il s'est tu. */
export function readbackFact(name: string): string {
  return `Le nom retenu est « ${name.trim()} ». ${readbackInstruction(name)}`;
}
