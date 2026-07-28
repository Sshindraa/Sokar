/**
 * Utilitaires de sécurité pour la communication `postMessage` du widget
 * embarqué en iframe chez les restaurateurs.
 *
 * Le widget communique avec son parent (le site du restaurateur) via
 * `window.parent.postMessage`. Utiliser `'*'` comme `targetOrigin` permettrait
 * à n'importe quel site intermédiaire d'intercepter ces messages. On dérive
 * donc l'origine du parent depuis `document.referrer`, ou depuis un paramètre
 * `parentOrigin` explicite passé dans l'URL du widget par le snippet embed.
 */

/**
 * Valide qu'une chaîne est une origine HTTP(S) utilisable comme targetOrigin.
 * Retourne l'origin normalisée ou `''` si invalide.
 */
function validateOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    // Refuser les origines non-HTTP (file://, about:blank, etc.)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * Détermine l'origine du parent (site du restaurateur) qui embarque le widget
 * en iframe.
 *
 * Priorité :
 * 1. `explicitParentOrigin` — paramètre `parentOrigin` passé dans l'URL du
 *    widget par le snippet embed contrôlé par Sokar. Permet de fonctionner
 *    même avec `Referrer-Policy: no-referrer` ou `iframe referrerpolicy="no-referrer"`.
 * 2. `document.referrer` — dérivé du referrer de l'iframe.
 *
 * Retourne `''` quand aucune source n'est disponible ou invalide — dans ce cas
 * on refuse d'envoyer plutôt que de retomber sur `'*'`.
 */
export function getParentOrigin(explicitParentOrigin?: string | null): string {
  // 1. Paramètre explicite (priorité haute)
  if (explicitParentOrigin) {
    const origin = validateOrigin(explicitParentOrigin);
    if (origin) return origin;
  }
  // 2. Referrer (fallback)
  try {
    if (document.referrer) {
      return validateOrigin(document.referrer);
    }
  } catch {
    // referrer invalide ou vide
  }
  return '';
}
