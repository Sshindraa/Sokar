import type { Page } from '@playwright/test';

/**
 * Le widget public se teste contre la vraie API en staging (`PLAYWRIGHT_BASE_URL`). Le restaurant de
 * démo n'y est ouvert que du mardi au samedi, et ni l'API de disponibilité ni le widget ne retirent
 * les créneaux déjà passés du jour : le jour et l'heure d'exécution ne doivent donc jamais être
 * supposés. Ces fonctions choisissent la date et les créneaux dans ce que l'API renvoie, en ne
 * gardant que les créneaux encore à venir à l'heure du restaurant.
 */

export const LOOKAHEAD_DAYS = 7;
/** Fuseau du restaurant de démo : c'est lui qui dit si un créneau est passé. */
export const RESTAURANT_TIME_ZONE = 'Europe/Paris';
/** Un créneau doit commencer dans plus de 15 min pour rester réservable pendant le test. */
export const MIN_LEAD_MINUTES = 15;
/** Taille de groupe initiale du widget (`useState(requestedPartySize ?? 2)`). */
export const DEFAULT_PARTY_SIZE = 2;
export const FIRST_PARTY_SIZE = 4;
export const CHANGED_PARTY_SIZE = 5;

// Mêmes libellés que le widget (`formatLongFrenchDate`) : ils nomment les boutons de date.
const FRENCH_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export type WidgetDay = {
  /** `YYYY-MM-DD`, paramètre `date` de l'URL et de l'API. */
  param: string;
  /** « mardi 13 octobre » : le nom du bouton, suivi de « ouvert » ou « fermé ». */
  label: string;
};

export type DayAvailability = WidgetDay & { slotsByParty: Record<number, string[]> };

/** L'heure qu'il est chez le restaurant. */
export type RestaurantNow = { date: string; minutes: number };

/** L'instant donné, lu à l'heure du restaurant. */
export function restaurantNowAt(instant: number | Date): RestaurantNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: RESTAURANT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** L'heure du restaurant selon l'horloge du navigateur (qui peut être simulée par `page.clock`). */
export async function restaurantNow(page: Page): Promise<RestaurantNow> {
  return restaurantNowAt(await page.evaluate(() => Date.now()));
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Les créneaux encore à venir : aucun pour un jour déjà passé chez le restaurant, ceux qui
 * commencent dans plus de `MIN_LEAD_MINUTES` pour aujourd'hui, tous pour les jours suivants.
 */
export function futureSlots(slots: string[], day: WidgetDay, now: RestaurantNow): string[] {
  if (day.param < now.date) return [];
  if (day.param > now.date) return slots;
  return slots.filter((slot) => minutesOf(slot) > now.minutes + MIN_LEAD_MINUTES);
}

export type BookingScenario = {
  firstDate: string;
  /** Créneau du premier jour, disponible pour les deux tailles de groupe. */
  firstTime: string;
  secondDate: string;
  secondLabel: string;
  secondTime: string;
};

/** « 20:30 » → « 20h30 », comme dans le nom des boutons. */
export function timeLabel(time: string): string {
  return time.replace(':', 'h');
}

/** Les prochains jours tels que le navigateur les voit, donc tels que le widget les propose. */
export async function upcomingDays(page: Page, count: number): Promise<WidgetDay[]> {
  return page.evaluate(
    ({ count: total, days, months }) =>
      Array.from({ length: total }, (_, offset) => {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        const pad = (value: number) => String(value).padStart(2, '0');
        return {
          param: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
          label: `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`,
        };
      }),
    { count, days: FRENCH_DAYS, months: FRENCH_MONTHS },
  );
}

function lastOf(slots: string[]): string | undefined {
  return [...slots].sort().at(-1);
}

function commonSlots(day: DayAvailability, now: RestaurantNow): string[] {
  const changed = new Set(futureSlots(day.slotsByParty[CHANGED_PARTY_SIZE] ?? [], day, now));
  return futureSlots(day.slotsByParty[FIRST_PARTY_SIZE] ?? [], day, now).filter((slot) =>
    changed.has(slot),
  );
}

/**
 * Premier jour ouvert avec un créneau futur pour 4 et 5 personnes, puis le jour suivant qui en
 * propose un pour 5. Le dernier créneau de chaque jour est retenu : c'est celui qui reste le plus
 * longtemps à venir entre la découverte et la réservation. `null` si aucun jour ne convient.
 */
export function pickScenario(days: DayAvailability[], now: RestaurantNow): BookingScenario | null {
  const firstIndex = days.findIndex((day) => commonSlots(day, now).length > 0);
  if (firstIndex < 0) return null;
  const first = days[firstIndex];
  const secondSlots = (day: DayAvailability) =>
    futureSlots(day.slotsByParty[CHANGED_PARTY_SIZE] ?? [], day, now);
  const second = days.slice(firstIndex + 1).find((day) => secondSlots(day).length > 0);
  if (!second) return null;
  return {
    firstDate: first.param,
    firstTime: lastOf(commonSlots(first, now)) as string,
    secondDate: second.param,
    secondLabel: second.label,
    secondTime: lastOf(secondSlots(second)) as string,
  };
}

/** Premier jour ouvert avec un créneau futur pour la taille de groupe par défaut du widget. */
export function pickFirstOpenDay(
  days: DayAvailability[],
  now: RestaurantNow,
): { label: string; time: string } | null {
  for (const day of days) {
    const slots = futureSlots(day.slotsByParty[DEFAULT_PARTY_SIZE] ?? [], day, now);
    if (slots.length > 0) return { label: day.label, time: lastOf(slots) as string };
  }
  return null;
}

function describeNow(now: RestaurantNow): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.date} ${pad(Math.floor(now.minutes / 60))}:${pad(now.minutes % 60)}`;
}

function describeDays(days: DayAvailability[]): string {
  return days
    .map((day) => {
      const counts = Object.entries(day.slotsByParty)
        .map(([party, slots]) => `${party} pers. : ${slots.length}`)
        .join(', ');
      return `${day.label} (${day.param}) → ${counts}`;
    })
    .join('\n  ');
}

/**
 * Interroge la vraie API, jour après jour, pour chaque taille de groupe, et s'arrête dès que
 * `enough` est satisfait : l'API limite le nombre de requêtes par minute, inutile de lire les sept
 * jours quand les deux premiers jours ouverts suffisent.
 */
export async function loadAvailability(
  page: Page,
  slug: string,
  partySizes: number[],
  enough: (days: DayAvailability[]) => boolean,
): Promise<DayAvailability[]> {
  const widget = await page.request.get(`/api/proxy/public/widget/${slug}`);
  if (!widget.ok()) {
    throw new Error(
      `Le widget de ${slug} est introuvable (HTTP ${widget.status()}) : impossible de choisir une date de réservation.`,
    );
  }
  const { id } = (await widget.json()) as { id: string };

  const result: DayAvailability[] = [];
  for (const day of await upcomingDays(page, LOOKAHEAD_DAYS)) {
    const slotsByParty: Record<number, string[]> = {};
    for (const partySize of partySizes) {
      const response = await page.request.get(
        `/api/proxy/restaurants/${id}/availability?date=${day.param}&partySize=${partySize}`,
      );
      if (!response.ok()) {
        throw new Error(
          `Disponibilités indisponibles pour ${slug} le ${day.param}, ${partySize} personnes (HTTP ${response.status()}).`,
        );
      }
      slotsByParty[partySize] = ((await response.json()) as { slots: string[] }).slots;
    }
    result.push({ ...day, slotsByParty });
    if (enough(result)) break;
  }
  return result;
}

export function noScenarioError(slug: string, days: DayAvailability[], now: RestaurantNow): Error {
  return new Error(
    `Aucun scénario de réservation possible pour ${slug} dans les ${LOOKAHEAD_DAYS} prochains jours : ` +
      `il faut un jour avec un créneau futur (à plus de ${MIN_LEAD_MINUTES} min, heure de Paris) pour ${FIRST_PARTY_SIZE} et ${CHANGED_PARTY_SIZE} personnes, ` +
      `puis un autre jour avec un créneau pour ${CHANGED_PARTY_SIZE} personnes. ` +
      `Vérifiez les horaires, les tables et les règles de réservation du restaurant.\n  Heure du restaurant : ${describeNow(now)}\n  ${describeDays(days)}`,
  );
}

export function noOpenDayError(slug: string, days: DayAvailability[], now: RestaurantNow): Error {
  return new Error(
    `Aucun jour ouvert avec un créneau futur pour ${DEFAULT_PARTY_SIZE} personnes pour ${slug} ` +
      `dans les ${LOOKAHEAD_DAYS} prochains jours. Vérifiez les horaires et les tables du restaurant.\n  Heure du restaurant : ${describeNow(now)}\n  ${describeDays(days)}`,
  );
}
