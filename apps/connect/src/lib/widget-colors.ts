/**
 * Sokar Connect — Widget color helpers.
 *
 * Validation des couleurs passées en query param pour les pages widget embed.
 */

export function toHexColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const hex = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : fallback;
}
