import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import { isPastVisitState } from './customer-voice-profile';

/**
 * Lifecycle status of a customer, computed from the real visits (the same
 * definition as the voice agent: honoured, seated, or a past confirmed booking
 * nobody cancelled or marked absent). The legacy `visitCount` counted every
 * phone booking and is never used here.
 */
export type CustomerLifecycleStatus = 'new' | 'active' | 'regular' | 'at_risk' | 'dormant';

export interface CustomerLifecycle {
  status: CustomerLifecycleStatus;
  /** Short French explanation shown next to the status. */
  reason: string;
}

const DAY_MS = 86_400_000;

/** Every threshold of the lifecycle, in one place. */
export const LIFECYCLE_THRESHOLDS = {
  /** Window for the "regular" count. */
  regularWindowDays: 90,
  /** Visits within `regularWindowDays` to be a regular. */
  regularMinVisits: 3,
  /** Past visits needed before a rhythm is trusted for "at risk". */
  rhythmMinVisits: 3,
  /** A customer is at risk once the gap exceeds this many usual intervals… */
  atRiskIntervalMultiplier: 2,
  /** …and at least this many days. */
  atRiskMinGapDays: 45,
  /** No visit for longer than this: dormant. */
  dormantAfterDays: 180,
  /** Up to this many visits, a customer is still new. */
  newMaxVisits: 1,
  /** Window for the no-show count shown during service. */
  noShowWindowDays: 365,
} as const;

export interface LifecycleReservation {
  state: string;
  status?: string | null;
  startsAt: Date | null;
  reservedAt: Date;
}

export interface CustomerVisitStats {
  visitDates: Date[];
  noShows365d: number;
}

/**
 * The one visit count shown everywhere (lists, profile, reactivation, duplicates):
 * honoured visits read from the reservations. Replaces the legacy `visitCount`
 * (phone bookings, absences included) and `lastSeenAt` (bumped by every call).
 */
export interface CustomerVisitSummary {
  visits: number;
  visits365d: number;
  noShows365d: number;
  lastVisitAt: Date | null;
}

export function summarizeVisits(stats: CustomerVisitStats, now: Date): CustomerVisitSummary {
  const since365 = now.getTime() - LIFECYCLE_THRESHOLDS.noShowWindowDays * DAY_MS;
  return {
    visits: stats.visitDates.length,
    visits365d: stats.visitDates.filter((date) => date.getTime() >= since365).length,
    noShows365d: stats.noShows365d,
    lastVisitAt: stats.visitDates[stats.visitDates.length - 1] ?? null,
  };
}

/** Past visits (ascending) and recent no-shows from a customer's reservations. */
export function summarizeLifecycleReservations(
  reservations: LifecycleReservation[],
  now: Date,
): CustomerVisitStats {
  const noShowSince = now.getTime() - LIFECYCLE_THRESHOLDS.noShowWindowDays * DAY_MS;
  const visitDates: Date[] = [];
  let noShows365d = 0;
  for (const reservation of reservations) {
    const date = reservation.startsAt ?? reservation.reservedAt;
    if (date.getTime() >= now.getTime()) continue;
    if (reservation.state === 'NO_SHOW' || reservation.status === 'NO_SHOW') {
      if (date.getTime() >= noShowSince) noShows365d += 1;
      continue;
    }
    if (reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') continue;
    if (isPastVisitState(reservation.state)) visitDates.push(date);
  }
  visitDates.sort((a, b) => a.getTime() - b.getTime());
  return { visitDates, noShows365d };
}

export function computeCustomerLifecycle(visitDates: Date[], now: Date): CustomerLifecycle {
  const t = LIFECYCLE_THRESHOLDS;
  const visits = [...visitDates]
    .filter((date) => date.getTime() < now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const last = visits[visits.length - 1];
  if (!last) return { status: 'new', reason: 'Aucune visite pour l’instant' };

  const daysSinceLast = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
  const interval = visits.length >= t.rhythmMinVisits ? medianIntervalDays(visits) : null;
  const habit = interval !== null ? `, venait ${rhythmLabel(interval)}` : '';

  if (daysSinceLast > t.dormantAfterDays) {
    return {
      status: 'dormant',
      reason: `Dernière visite il y a ${elapsedLabel(daysSinceLast)}${habit}`,
    };
  }
  if (
    interval !== null &&
    daysSinceLast > t.atRiskMinGapDays &&
    daysSinceLast > interval * t.atRiskIntervalMultiplier
  ) {
    return {
      status: 'at_risk',
      reason: `Dernière visite il y a ${elapsedLabel(daysSinceLast)}${habit}`,
    };
  }
  const windowStart = now.getTime() - t.regularWindowDays * DAY_MS;
  const recentVisits = visits.filter((date) => date.getTime() >= windowStart).length;
  if (recentVisits >= t.regularMinVisits) {
    return { status: 'regular', reason: `${recentVisits} visites en ${t.regularWindowDays} jours` };
  }
  if (visits.length <= t.newMaxVisits) {
    return { status: 'new', reason: `Première visite il y a ${elapsedLabel(daysSinceLast)}` };
  }
  return {
    status: 'active',
    reason: `${visits.length} visites, la dernière il y a ${elapsedLabel(daysSinceLast)}`,
  };
}

function medianIntervalDays(visits: Date[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < visits.length; index += 1) {
    gaps.push((visits[index].getTime() - visits[index - 1].getTime()) / DAY_MS);
  }
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}

function rhythmLabel(intervalDays: number): string {
  if (intervalDays <= 10) return 'chaque semaine';
  if (intervalDays <= 20) return 'toutes les deux semaines';
  if (intervalDays <= 45) return 'tous les mois';
  return `tous les ${Math.round(intervalDays / 30)} mois`;
}

function elapsedLabel(days: number): string {
  if (days < 1) return 'moins d’un jour';
  if (days < 14) return days === 1 ? '1 jour' : `${days} jours`;
  if (days < 60) return `${Math.floor(days / 7)} semaines`;
  return `${Math.floor(days / 30)} mois`;
}

/**
 * Visit stats for several customers in one query, scoped to the restaurant.
 * Customers without any reservation get empty stats.
 */
export async function loadCustomerVisitStats(
  restaurantId: string,
  customerIds: string[],
  now = new Date(),
): Promise<Map<string, CustomerVisitStats>> {
  const ids = [...new Set(customerIds)];
  const stats = new Map<string, CustomerVisitStats>();
  if (ids.length === 0) return stats;
  // Whole history: a window made a regular from three years ago look like a new customer.
  const reservations = await db.reservation.findMany({
    where: {
      restaurantId,
      customerId: { in: ids },
    },
    select: { customerId: true, state: true, status: true, startsAt: true, reservedAt: true },
  });
  const byCustomer = new Map<string, LifecycleReservation[]>();
  for (const reservation of reservations) {
    if (!reservation.customerId) continue;
    const list = byCustomer.get(reservation.customerId) ?? [];
    list.push({
      state: String(reservation.state),
      status: String(reservation.status),
      startsAt: reservation.startsAt,
      reservedAt: reservation.reservedAt,
    });
    byCustomer.set(reservation.customerId, list);
  }
  for (const id of ids) {
    stats.set(id, summarizeLifecycleReservations(byCustomer.get(id) ?? [], now));
  }
  return stats;
}

/**
 * Keeps the ids whose status and honoured visits match, from the reservations: the numbers the
 * lists then show. Order is preserved.
 */
export async function filterCustomerIdsByVisits(
  restaurantId: string,
  ids: string[],
  filters: { lifecycle?: CustomerLifecycleStatus; minHonored365d?: number },
  now: Date,
): Promise<string[]> {
  const stats = await loadCustomerVisitStats(restaurantId, ids, now);
  return ids.filter((id) => {
    const customerStats = stats.get(id) ?? { visitDates: [], noShows365d: 0 };
    if (
      filters.minHonored365d !== undefined &&
      summarizeVisits(customerStats, now).visits365d < filters.minHonored365d
    ) {
      return false;
    }
    return (
      filters.lifecycle === undefined ||
      computeCustomerLifecycle(customerStats.visitDates, now).status === filters.lifecycle
    );
  });
}

/**
 * Adds `lifecycle` to each customer of a page, with a single reservation query.
 * Best effort: the status is an additive field, so a failed read leaves it null
 * instead of breaking the customer list.
 */
export async function withCustomerLifecycles<T extends { id: string }>(
  restaurantId: string,
  customers: T[],
  now = new Date(),
): Promise<
  Array<T & { lifecycle: CustomerLifecycle | null; visitSummary: CustomerVisitSummary | null }>
> {
  let stats: Map<string, CustomerVisitStats> | null = null;
  try {
    stats = await loadCustomerVisitStats(
      restaurantId,
      customers.map((customer) => customer.id),
      now,
    );
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error), restaurantId },
      '[crm] customer lifecycle unavailable',
    );
  }
  return customers.map((customer) => {
    const customerStats = stats?.get(customer.id) ?? { visitDates: [], noShows365d: 0 };
    return {
      ...customer,
      lifecycle: stats ? computeCustomerLifecycle(customerStats.visitDates, now) : null,
      visitSummary: stats ? summarizeVisits(customerStats, now) : null,
    };
  });
}
