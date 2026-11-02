import { db } from '../../shared/db/client';
import { COUNTED_RESERVATION_STATES } from '../../shared/reservations/reservation-state';
import { DEFAULT_RESTAURANT_TIMEZONE, zonedTimeToUtc } from '../../shared/timezone/restaurant-time';
import { addDays } from '../companion/query-data';
import { SERVICE_SPLIT_HOUR, type TonightService } from '../companion/tonight';

export type ServiceWindow = { start: Date; end: Date };
export type ForecastSource = 'historique' | 'simple';
export type ForecastRow = { reservedAt: Date; createdAt: Date; partySize: number };

const FORECAST_LOOKBACK_WEEKS = 12;
const FORECAST_MAX_SERVICES = 8;
const FORECAST_MIN_SERVICES = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

// Même découpage que « Ce soir » : midi avant 16 h (Paris), soir à partir de 16 h.
export function dayBounds(date: string): ServiceWindow {
  return {
    start: zonedTimeToUtc(date, '00:00', DEFAULT_RESTAURANT_TIMEZONE),
    end: zonedTimeToUtc(addDays(date, 1), '00:00', DEFAULT_RESTAURANT_TIMEZONE),
  };
}

export function serviceWindow(date: string, service: TonightService): ServiceWindow {
  const day = dayBounds(date);
  const cut = zonedTimeToUtc(date, `${SERVICE_SPLIT_HOUR}:00`, DEFAULT_RESTAURANT_TIMEZONE);
  return service === 'midi' ? { start: day.start, end: cut } : { start: cut, end: day.end };
}

export function loadForecastHistory(restaurantId: string, now: Date): Promise<ForecastRow[]> {
  return db.reservation.findMany({
    where: {
      restaurantId,
      isTest: false,
      state: { in: [...COUNTED_RESERVATION_STATES] },
      reservedAt: { gte: new Date(now.getTime() - FORECAST_LOOKBACK_WEEKS * 7 * DAY_MS), lt: now },
    },
    select: { reservedAt: true, createdAt: true, partySize: true },
  });
}

/**
 * Places vides probables = places libres − arrivées tardives attendues (médiane des couverts
 * réservés, sur les services comparables passés, après le même délai avant le service).
 * shortcut: médiane sans saison ni jours fériés ni annulations ; à affiner quand des restaurants
 * ont plusieurs mois d'historique suivi.
 */
export function forecastEmptyPlaces(args: {
  rows: ForecastRow[];
  date: string;
  service: TonightService;
  freePlaces: number;
  now: Date;
}): { emptyPlaces: number; lateArrivals: number; forecastSource: ForecastSource } {
  const leadMs = serviceWindow(args.date, args.service).start.getTime() - args.now.getTime();
  const arrivals: number[] = [];
  for (let k = 1; k <= FORECAST_LOOKBACK_WEEKS && arrivals.length < FORECAST_MAX_SERVICES; k++) {
    const { start, end } = serviceWindow(addDays(args.date, -7 * k), args.service);
    const threshold = start.getTime() - leadMs;
    const inService = args.rows.filter((r) => r.reservedAt >= start && r.reservedAt < end);
    if (inService.length === 0) continue;
    arrivals.push(
      inService
        .filter((r) => r.createdAt.getTime() >= threshold)
        .reduce((n, r) => n + r.partySize, 0),
    );
  }
  if (arrivals.length < FORECAST_MIN_SERVICES) {
    return { emptyPlaces: args.freePlaces, lateArrivals: 0, forecastSource: 'simple' };
  }
  arrivals.sort((a, b) => a - b);
  const mid = arrivals.length / 2;
  const median =
    arrivals.length % 2 ? arrivals[Math.floor(mid)] : (arrivals[mid - 1] + arrivals[mid]) / 2;
  const lateArrivals = Math.round(median);
  return {
    emptyPlaces: Math.max(0, args.freePlaces - lateArrivals),
    lateArrivals,
    forecastSource: 'historique',
  };
}
