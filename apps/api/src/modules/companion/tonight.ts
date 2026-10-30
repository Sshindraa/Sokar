/**
 * Carte « Ce soir » : le service en cours du restaurant, calculé par le serveur. Le modèle n'est
 * jamais appelé et ne reçoit rien de cette carte. Le texte des demandes spéciales n'est jamais
 * renvoyé, et aucun nom ni téléphone n'est journalisé.
 */
import { db } from '../../shared/db/client';
import { COUNTED_RESERVATION_STATES } from '../../shared/reservations/reservation-state';
import { addDays, parisMidnight, parisParts } from './query-data';

// Avant 16 h (heure de Paris) : service de midi. À partir de 16 h : service du soir.
const SERVICE_SPLIT_HOUR = 16;
const LARGE_PARTY_SIZE = 6;
const REGULAR_MIN_HONORED = 3;
const USUAL_WEEKS = 4;
const SERVICE_STATES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;
const UNCONFIRMED_STATUSES: string[] = ['PENDING', 'NO_REPLY'];

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type TonightService = 'midi' | 'soir';

export interface TonightRow {
  reservationId: string;
  name: string;
  time: string;
  partySize: number;
  reasons: string[];
}

export interface TonightCard {
  service: TonightService;
  /** Jour de Paris, AAAA-MM-JJ. */
  date: string;
  covers: number;
  /** Couverts moyens du même service, même jour de semaine, sur les 4 semaines précédentes. */
  usualCovers: number | null;
  specialRequestsCount: number;
  waitlistCount: number;
  /** Réservations à surveiller : confirmation, table, grande tablée, absence passée. */
  watch: TonightRow[];
  /** Clients VIP et réguliers. */
  attention: TonightRow[];
}

function isInService(at: Date, service: TonightService): boolean {
  const { hour } = parisParts(at);
  return service === 'midi' ? hour < SERVICE_SPLIT_HOUR : hour >= SERVICE_SPLIT_HOUR;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function computeTonight(restaurantId: string, now: Date): Promise<TonightCard> {
  const today = parisParts(now);
  const service: TonightService = today.hour < SERVICE_SPLIT_HOUR ? 'midi' : 'soir';
  const dayStart = parisMidnight(today.dayKey);
  const dayEnd = parisMidnight(addDays(today.dayKey, 1));
  const usualStart = parisMidnight(addDays(today.dayKey, -7 * USUAL_WEEKS));
  const yearAgo = new Date(`${today.dayKey}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const yearAgoStart = parisMidnight(yearAgo.toISOString().slice(0, 10));

  const [dayRows, usualRows, waitlistRows] = await Promise.all([
    db.reservation.findMany({
      where: {
        restaurantId,
        state: { in: [...SERVICE_STATES] },
        reservedAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        reservedAt: true,
        customerName: true,
        partySize: true,
        customerId: true,
        confirmationStatus: true,
        tableId: true,
        specialRequests: true,
        customer: { select: { isVip: true } },
      },
      orderBy: { reservedAt: 'asc' },
    }),
    db.reservation.findMany({
      where: {
        restaurantId,
        state: { in: [...COUNTED_RESERVATION_STATES] },
        reservedAt: { gte: usualStart, lt: dayStart },
      },
      select: { reservedAt: true, partySize: true },
    }),
    db.waitingListEntry.findMany({
      where: {
        restaurantId,
        status: 'PENDING',
        slotStart: { gte: dayStart, lt: dayEnd },
      },
      select: { slotStart: true },
    }),
  ]);

  const rows = dayRows.filter((row) => isInService(row.reservedAt, service));

  // Moyenne sur les jours où ce service a des réservations valables : un jour de fermeture ne compte pas.
  const coversByDay = new Map<string, number>();
  for (const row of usualRows) {
    const at = parisParts(row.reservedAt);
    if (at.weekday !== today.weekday || !isInService(row.reservedAt, service)) continue;
    coversByDay.set(at.dayKey, (coversByDay.get(at.dayKey) ?? 0) + row.partySize);
  }
  const usualTotal = [...coversByDay.values()].reduce((sum, covers) => sum + covers, 0);
  const usualCovers = coversByDay.size === 0 ? null : roundOne(usualTotal / coversByDay.size);

  const customerIds = [...new Set(rows.flatMap((row) => (row.customerId ? [row.customerId] : [])))];
  const pastNoShowIds = new Set<string>();
  const honoredCounts = new Map<string, number>();
  if (customerIds.length > 0) {
    const [noShows, honored] = await Promise.all([
      db.reservation.findMany({
        where: {
          restaurantId,
          customerId: { in: customerIds },
          state: 'NO_SHOW',
          reservedAt: { gte: yearAgoStart, lt: dayStart },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
      db.reservation.groupBy({
        by: ['customerId'],
        where: {
          restaurantId,
          customerId: { in: customerIds },
          state: 'HONORED',
          reservedAt: { lt: dayStart },
        },
        _count: { _all: true },
      }),
    ]);
    for (const row of noShows) {
      if (row.customerId) pastNoShowIds.add(row.customerId);
    }
    for (const group of honored) {
      if (group.customerId) honoredCounts.set(group.customerId, group._count._all);
    }
  }

  const watch: TonightRow[] = [];
  const attention: TonightRow[] = [];
  for (const row of rows) {
    const time = timeFormatter.format(row.reservedAt);
    const watchReasons: string[] = [];
    if (UNCONFIRMED_STATUSES.includes(row.confirmationStatus)) watchReasons.push('unconfirmed');
    if (row.tableId === null) watchReasons.push('noTable');
    if (row.partySize >= LARGE_PARTY_SIZE) watchReasons.push('largeParty');
    if (row.customerId && pastNoShowIds.has(row.customerId)) watchReasons.push('pastNoShow');

    const attentionReasons: string[] = [];
    if (row.customer?.isVip) attentionReasons.push('vip');
    if (row.customerId && (honoredCounts.get(row.customerId) ?? 0) >= REGULAR_MIN_HONORED) {
      attentionReasons.push('regular');
    }

    const line = { reservationId: row.id, name: row.customerName, time, partySize: row.partySize };
    if (watchReasons.length > 0) watch.push({ ...line, reasons: watchReasons });
    if (attentionReasons.length > 0) attention.push({ ...line, reasons: attentionReasons });
  }

  return {
    service,
    date: today.dayKey,
    covers: rows.reduce((sum, row) => sum + row.partySize, 0),
    usualCovers,
    specialRequestsCount: rows.filter((row) => row.specialRequests?.trim()).length,
    waitlistCount: waitlistRows.filter((row) => isInService(row.slotStart, service)).length,
    watch,
    attention,
  };
}
