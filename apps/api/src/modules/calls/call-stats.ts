/**
 * Appels reçus par l'assistant téléphonique Léa, pour l'outil call_stats du Companion : intention,
 * résultat, hors horaires d'ouverture et durée moyenne. Ne lit que la date, l'intention, le résultat
 * et la durée : jamais le numéro de l'appelant ni la transcription.
 */
import { normalizeOpeningHours } from '@sokar/shared';
import { db } from '../../shared/db/client';
import { periodStart } from '../dashboard/dashboard.routes';

export type CallStatsPeriod = 'today' | '7d' | '30d';

const PARIS_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parisClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Accepte « 24:00 » : la fermeture après minuit est déjà découpée par normalizeOpeningHours.
const toMinutes = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

/** Vrai si l'instant tombe dans une période d'ouverture, à l'heure de Paris. */
export function isWithinOpeningHours(date: Date, openingHours: unknown): boolean {
  const parts = parisClock.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const weekday = PARIS_WEEKDAYS.indexOf(part('weekday'));
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  return normalizeOpeningHours(openingHours).some(
    (period) =>
      period.dayIndex === weekday &&
      toMinutes(period.open) <= minutes &&
      minutes < toMinutes(period.close),
  );
}

export async function computeCallStats(restaurantId: string, period: CallStatsPeriod) {
  const [restaurant, calls] = await Promise.all([
    db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { openingHours: true },
    }),
    db.call.findMany({
      where: { restaurantId, createdAt: { gte: periodStart(period) } },
      select: { createdAt: true, intent: true, outcome: true, durationSec: true },
    }),
  ]);

  const byIntent = { RESERVATION: 0, HOURS: 0, MENU: 0, CANCEL: 0, OTHER: 0, unknown: 0 };
  const byOutcome = {
    RESERVED: 0,
    INFO: 0,
    MESSAGE: 0,
    NO_ACTION: 0,
    HANDOFF: 0,
    ERROR: 0,
    unfinished: 0,
  };
  for (const call of calls) {
    if (call.intent) byIntent[call.intent] += 1;
    else byIntent.unknown += 1;
    if (call.outcome) byOutcome[call.outcome] += 1;
    else byOutcome.unfinished += 1;
  }

  const durations = calls.flatMap((call) => (call.durationSec == null ? [] : [call.durationSec]));
  const hasHours = normalizeOpeningHours(restaurant.openingHours).length > 0;

  return {
    period,
    total: calls.length,
    byIntent,
    byOutcome,
    afterHours: hasHours
      ? calls.filter((call) => !isWithinOpeningHours(call.createdAt, restaurant.openingHours))
          .length
      : null,
    avgDurationSec:
      durations.length > 0
        ? Math.round(durations.reduce((sum, seconds) => sum + seconds, 0) / durations.length)
        : null,
  };
}
