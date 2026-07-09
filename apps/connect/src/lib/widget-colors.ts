/**
 * Sokar Connect — Widget color + slug helpers.
 *
 * Validation des couleurs et slugs passés en query param pour les pages widget embed.
 */

export function toHexColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const hex = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : fallback;
}

/**
 * Valide un slug restaurant (alphanumérique + tirets, 3-80 chars).
 * Évite l'injection de caractères malicieux dans les URLs et le rendu.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/.test(slug);
}
