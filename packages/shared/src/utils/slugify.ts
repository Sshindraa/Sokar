/**
 * Slugify helpers pour le référentiel Connect (villes et cuisines).
 *
 * Utilisé par l'API public /public/cities et peut être consommé par
 * apps/connect pour garantir la cohérence slug côté client.
 */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function slugifyCity(name: string): string {
  return slugify(name);
}

export function slugifyCuisine(name: string): string {
  return slugify(name);
}
