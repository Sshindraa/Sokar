/**
 * Ancrage des chiffres : chaque chiffre d'une réponse doit figurer dans les données transmises
 * (résultats d'outils, agrégats du résumé). Partagé par le banc du Companion et par le résumé
 * « Ce soir » en production. Aucune conversion : un pourcentage cité doit être un nombre des données.
 */
export const WEEKDAYS = 'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche';

// Un nombre de la réponse suffit. Accepte « 1 234 », « 1234 », « 4,2 » et « 4.2 ».
export function numbersIn(reply: string): number[] {
  const tokens = reply.match(/\d{1,3}(?:[\s  ]\d{3})+(?:[,.]\d+)?|\d+(?:[,.]\d+)?/g) ?? [];
  return tokens.map((token) => Number(token.replace(/[\s  ]/g, '').replace(',', '.')));
}

// Nombres qui doivent venir d'un outil : hors dates, années, heures, durées et formules de calendrier.
const MONTHS =
  'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
export function figuresIn(reply: string): number[] {
  const text = reply
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    // Mois sous forme AAAA-MM : « 2026-09 » ne contient pas le chiffre 09 à ancrer.
    .replace(/\b\d{4}-\d{2}\b/g, ' ')
    // Intervalles : « du 1er au 30 », « du lundi 26 au vendredi 30 », « entre le 1er et le 30 ».
    .replace(
      new RegExp(
        `\\b(?:du|au)\\s+(?:(?:${WEEKDAYS})\\s+)?\\d{1,2}(?:er)?\\s+au\\s+(?:(?:${WEEKDAYS})\\s+)?\\d{1,2}(?:er)?\\b`,
        'gi',
      ),
      ' ',
    )
    .replace(/\bentre\s+le\s+\d{1,2}(?:er)?\s+et\s+le\s+\d{1,2}(?:er)?\b/gi, ' ')
    // Intervalle de jours suivi d'un mois : « 25 au 31 octobre », « 25 au 31 octobre 2026 ».
    .replace(
      new RegExp(
        `\\b\\d{1,2}(?:er)?\\s+au\\s+\\d{1,2}(?:er)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`,
        'gi',
      ),
      ' ',
    )
    // Listes de jours suivies d'un mois : « les 5, 6 et 7 septembre ».
    .replace(
      new RegExp(`\\b(?:\\d{1,2}(?:,\\s*|\\s+et\\s+))+\\d{1,2}\\s+(?:${MONTHS})\\b`, 'gi'),
      ' ',
    )
    .replace(new RegExp(`\\b(?:${WEEKDAYS})\\s+\\d{1,2}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:er)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\s?h(?:\s?\d{2})?\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(
      /\b\d+\s+(?:derniers?|dernières?|prochains?|prochaines?)?\s*(?:jours?|semaines?|mois|heures?|minutes?|lundis|mardis|mercredis|jeudis|vendredis|samedis|dimanches)\b/gi,
      ' ',
    )
    .replace(/\b1er\b/gi, ' ')
    .replace(/\bsur\s+5\b/gi, ' ');
  return numbersIn(text);
}

function collectNumbers(value: unknown, into: number[]): void {
  if (typeof value === 'number') into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectNumbers(item, into));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectNumbers(item, into));
  }
}

// Ancrage : chaque chiffre de la réponse figure dans un résultat d'outil de la même réponse.
export function anchoredIn(
  reply: string,
  calls: Array<{ result: unknown }>,
): { ok: boolean; unanchored: number[] } {
  const available: number[] = [];
  for (const call of calls) collectNumbers(call.result, available);
  // Le signe d'un écart se dit en mots (« baisse de 20 % ») : seule la valeur absolue compte.
  // Un chiffre arrondi à l'unité ou au dixième est ancré : arrondir n'est pas calculer.
  // Un entier s'accepte à la demi-unité près, un décimal au dixième près.
  const matches = (value: number, figure: number) => {
    const tolerance = Number.isInteger(figure) ? 0.5 : 0.05;
    return Math.abs(Math.abs(value) - figure) <= tolerance + 1e-9;
  };
  const unanchored = figuresIn(reply).filter(
    (figure) => !available.some((value) => matches(value, figure)),
  );
  return { ok: unanchored.length === 0, unanchored };
}
