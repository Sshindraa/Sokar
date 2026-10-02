/**
 * Relecture du nom lettre par lettre, construite par le code et jamais par le modèle.
 *
 * Appel 8043662c : le nom dit « A, deux S, A, M » a été transcrit « a deux s a deux m » (erreur de reconnaissance
 * que le code ne peut pas voir) ; le modèle a relu « Assamm, avec deux s et deux m », que la voix lit « deux
 * secondes et deux mètres » : l'appelant n'a pas entendu l'erreur et a confirmé. La relecture est la seule
 * protection contre une erreur de reconnaissance : elle doit être celle des lettres du brouillon, dans une forme
 * que la voix lit comme des lettres (majuscules séparées par des virgules, une lettre doublée dite « deux X »),
 * vérifiée en synthèse réelle.
 *
 * Le modèle écrit seulement le marqueur à l'endroit où il relit le nom ; le code le remplace. Aucun mot, aucune
 * phrase : la forme des lettres est construite à partir des lettres.
 */

export const READBACK_MARKER = '[[NOM]]';

const MARKER_PATTERN = /\[\[\s*nom\s*\]\]/giu;
const MARKER_TEST = /\[\[\s*nom\s*\]\]/iu;

/** Nombre de fois qu'une lettre se répète de suite, dit en mot jusqu'à trois ; au-delà, la lettre est répétée. */
const COUNT_WORDS: Record<number, string> = { 2: 'deux', 3: 'trois' };

const stripToUppercaseLetters = (word: string): string =>
  word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}]/gu, '')
    .toLocaleUpperCase('fr-FR');

function readWord(letters: string): string {
  const parts: string[] = [];
  for (let index = 0; index < letters.length; ) {
    let end = index + 1;
    while (end < letters.length && letters[end] === letters[index]) end++;
    const count = end - index;
    const word = COUNT_WORDS[count];
    if (word) parts.push(`${word} ${letters[index]}`);
    else parts.push(...Array.from({ length: count }, () => letters[index]));
    index = end;
  }
  return parts.join(', ');
}

/**
 * Les lettres du nom, lues une à une : « A, deux S, A, M ». Les mots d'un nom composé sont séparés par un point
 * (« D, E. L, A. F, O, N, T, A, I, N, E »). Null quand le nom n'a aucune lettre.
 */
export function nameReadback(name: string): string | null {
  const words = name
    .trim()
    .split(/[\s'’-]+/u)
    .map(stripToUppercaseLetters)
    .filter(Boolean);
  if (!words.length) return null;
  return words.map(readWord).join('. ');
}

/** La phrase du modèle porte la relecture : le marqueur (remplacé ensuite), ou déjà les lettres exactes. */
export function sayCarriesReadback(say: string, name: string): boolean {
  if (MARKER_TEST.test(say)) return true;
  const readback = nameReadback(name);
  return readback !== null && say.includes(readback);
}

/** Remplace le marqueur par la relecture du nom ; sans lettres à lire, le marqueur est simplement retiré. */
export function fillReadbackMarker(say: string, name: string): string {
  const readback = nameReadback(name);
  return say
    .replace(MARKER_PATTERN, readback ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function hasReadbackMarker(text: string): boolean {
  return MARKER_TEST.test(text);
}

/**
 * Fait donné au second passage quand la phrase du modèle ne porte pas le marqueur : il se tait, le code lit le nom.
 * Aucun exemple de phrase : seulement ce que le modèle doit écrire à la place des lettres.
 */
export function readbackFact(name: string): string {
  return (
    `Le nom retenu est « ${name.trim()} ». Tu ne relis jamais les lettres toi-même, et tu ne décris jamais leur graphie : ` +
    `à l'endroit où tu relis le nom, écris le marqueur ${READBACK_MARKER} ; le code le remplace par les lettres, lues une à une. ` +
    `Relis ainsi uniquement ce nom, puis demande si c'est bien ça (awaiting=customerNameConfirmation).`
  );
}
