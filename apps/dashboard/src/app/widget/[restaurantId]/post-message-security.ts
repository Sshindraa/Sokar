/**
 * Utilitaires de sécurité pour la communication `postMessage` du widget
 * embarqué en iframe chez les restaurateurs.
 *
 * Le widget communique avec son parent (le site du restaurateur) via
 * `window.parent.postMessage`. Utiliser `'*'` comme `targetOrigin` permettrait
 * à n'importe quel site intermédiaire d'intercepter ces messages. On dérive
 * donc l'origine du parent depuis `document.referrer`.
 */

/**
 * Détermine l'origine du parent (site du restaurateur) qui embarque le widget
 * en iframe. On dérive depuis `document.referrer` plutôt que d'utiliser `'*'`
 * comme targetOrigin : un `'*'` permettrait à n'importe quel site intermédiaire
 * d'intercepter les messages `postMessage` sortants.
 *
 * Retourne `''` quand le referrer est vide ou invalide (file://, about:blank,
 * redirection opaque) — dans ce cas on refuse d'envoyer plutôt que de retomber
 * sur `'*'`.
 */
export function getParentOrigin(): string {
  try {
    if (document.referrer) {
      const url = new URL(document.referrer);
      return url.origin;
    }
  } catch {
    // referrer invalide ou vide
  }
  return '';
}
