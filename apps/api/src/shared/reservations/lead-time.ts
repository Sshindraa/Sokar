import type { PrismaClient } from '@prisma/client';
import { isSlotStartPast, zonedTimeToUtc } from '../timezone/restaurant-time.js';

/**
 * Délai minimum de réservation en ligne (`minLeadTimeMinutes`, réglé à « Règles et diffusion »).
 *
 * UNE règle, utilisée à l'affichage (le moteur de disponibilités marque le créneau indisponible) ET à
 * la validation (hold, création, confirmation), pour que les deux ne divergent jamais. Elle s'applique
 * aux surfaces en ligne : page et widget Connect, ancienne page /book, cartes cadeaux, MCP. Elle ne
 * s'applique ni au téléphone ni au personnel : ces appelants ne passent pas de délai (donc 0).
 */

/** Code d'erreur stable côté API et clients (déjà celui de `PolicyValidationError`). */
export const INSUFFICIENT_LEAD_TIME = 'INSUFFICIENT_LEAD_TIME';

/** Délai appliqué quand le restaurant n'a pas de réglages (même valeur que le snapshot de policy). */
export const DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES = 30;

/**
 * Un créneau est trop proche s'il a commencé (règle « passé ») ou s'il commence avant maintenant plus
 * le délai. Un créneau qui commence exactement à maintenant + délai reste réservable.
 */
export function isSlotTooSoon(
  slotStart: Date,
  minLeadTimeMinutes: number = 0,
  now: Date = new Date(),
): boolean {
  if (isSlotStartPast(slotStart, now)) return true;
  const lead = Number.isFinite(minLeadTimeMinutes) ? Math.max(0, minLeadTimeMinutes) : 0;
  return slotStart.getTime() < now.getTime() + lead * 60_000;
}

/** Même règle pour « date + heure locales du restaurant » (le fuseau du serveur n'entre jamais en jeu). */
export function isSlotTooSoonAt(
  dateStr: string,
  timeStr: string,
  timeZone: string,
  minLeadTimeMinutes: number = 0,
  now: Date = new Date(),
): boolean {
  return isSlotTooSoon(zonedTimeToUtc(dateStr, timeStr, timeZone), minLeadTimeMinutes, now);
}

/** « 30 min », « 2 h », « 1 h 30 ». */
export function formatLeadTime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/** Message au client, en français et au vouvoiement. */
export function leadTimeMessage(minLeadTimeMinutes: number): string {
  if (!(minLeadTimeMinutes > 0)) return 'Ce créneau est déjà passé.';
  return `Ce créneau est trop proche : ce restaurant accepte les réservations au moins ${formatLeadTime(minLeadTimeMinutes)} à l’avance.`;
}

/**
 * Corps d'une réponse 409. `error` porte le message français : les clients qui affichent `error`
 * (page /book, widgets) le montrent tel quel ; `code` permet aux autres de réagir sans lire le texte.
 */
export function leadTimeRefusal(minLeadTimeMinutes: number) {
  return {
    error: leadTimeMessage(minLeadTimeMinutes),
    code: INSUFFICIENT_LEAD_TIME,
    minLeadTimeMinutes,
  };
}

/** Le délai du restaurant, ou le défaut s'il n'a pas de réglages. */
export async function loadMinLeadTimeMinutes(
  prisma: Pick<PrismaClient, 'restaurantExposureSettings'>,
  restaurantId: string,
): Promise<number> {
  const settings = await prisma.restaurantExposureSettings.findUnique({
    where: { restaurantId },
    select: { minLeadTimeMinutes: true },
  });
  return settings?.minLeadTimeMinutes ?? DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES;
}
