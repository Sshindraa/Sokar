/**
 * Découpage en jetons pour comparer deux transcriptions du même audio.
 *
 * Aucune liste de mots : minuscules, ponctuation retirée, élisions gardées (« s'il » reste un jeton,
 * sinon chaque « s' » passerait pour une lettre épelée), lettres et chiffres collés séparés
 * (« a2m » → « a », « 2 », « m »).
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}']+/u)
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}
