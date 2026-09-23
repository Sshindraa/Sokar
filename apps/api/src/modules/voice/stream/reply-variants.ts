import type { CallSession } from './types';

/**
 * Choisit une formulation jamais encore dite pour cette clé dans l'appel.
 * Quand toutes ont servi, on repart sans reprendre la dernière dite, pour
 * qu'une même formule ne revienne jamais deux fois de suite.
 */
export function pickVariant(
  session: Pick<CallSession, 'replyVariantHistory'>,
  key: string,
  variants: readonly string[],
): string {
  if (variants.length === 0) return '';
  const historyByKey = (session.replyVariantHistory ??= {});
  const history = (historyByKey[key] ??= []);
  let index = variants.findIndex((_, candidate) => !history.includes(candidate));
  if (index < 0) {
    const last = history[history.length - 1];
    index = variants.findIndex((_, candidate) => candidate !== last);
    if (index < 0) index = 0;
    history.length = 0;
  }
  history.push(index);
  return variants[index];
}
