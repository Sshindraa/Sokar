/**
 * Placement virtuel des réservations et holds sans table.
 *
 * Une réservation ou un hold sans table ne ferme plus tout le restaurant : il occupe virtuellement la
 * plus petite table libre compatible, dans l'ordre d'arrivée. Il ne bloque globalement son intervalle
 * que si aucune table ne peut l'absorber. La disponibilité, la création, la modification et
 * l'allocation passent toutes par ces fonctions, pour rester d'accord entre elles.
 */
import type { Prisma } from '@prisma/client';
import {
  ACTIVE_RESERVATION_STATES,
  intervalsOverlap,
  reservationOverlapWhere,
} from '../../shared/reservations/capacity.js';
import {
  DEFAULT_RESTAURANT_TIMEZONE,
  utcToZonedParts,
  zonedTimeToUtc,
} from '../../shared/timezone/restaurant-time.js';
import { resolveServiceDurationMinutes } from './floor-plan.types';

export type SeatingDb = Pick<
  Prisma.TransactionClient,
  'restaurant' | 'restaurantExposureSettings' | 'table' | 'reservation' | 'agenticHold'
>;

export type SeatingTable = {
  id: string;
  sectionId: string | null;
  capacity: number;
  minCapacity: number;
};

/** Réservation ou hold : `tableId` renseigné = table fixée, sinon placé virtuellement. */
export type SeatingItem = {
  partySize: number;
  start: Date;
  end: Date;
  tableId: string | null;
};

type Interval = { start: Date; end: Date };

export type SeatingPlan = {
  busyByTable: Map<string, Interval[]>;
  /** Éléments qu'aucune table ne peut absorber : ils bloquent globalement leur intervalle. */
  blocked: Interval[];
};

export type SeatingCandidate = Interval & {
  partySize: number;
  /** Section préférée : seules ses tables comptent pour le candidat. */
  sectionId?: string | null;
};

function fitsParty(table: SeatingTable, partySize: number): boolean {
  return table.capacity >= partySize && table.minCapacity <= partySize;
}

function isFree(busy: Interval[] | undefined, start: Date, end: Date): boolean {
  return !(busy ?? []).some((b) => intervalsOverlap(b.start, b.end, start, end));
}

/**
 * Place les éléments sans table, dans l'ordre fourni (ordre d'arrivée), sur la plus petite table libre
 * compatible. Les éléments avec table occupent d'abord leur table.
 */
export function planUnassignedSeating(tables: SeatingTable[], items: SeatingItem[]): SeatingPlan {
  const busyByTable = new Map<string, Interval[]>();
  const occupy = (tableId: string, interval: Interval) => {
    busyByTable.set(tableId, [...(busyByTable.get(tableId) ?? []), interval]);
  };
  for (const item of items) {
    if (item.tableId) occupy(item.tableId, item);
  }

  const bySize = [...tables].sort(
    (a, b) => a.capacity - b.capacity || a.minCapacity - b.minCapacity || a.id.localeCompare(b.id),
  );
  const blocked: Interval[] = [];
  for (const item of items) {
    if (item.tableId) continue;
    const table = bySize.find(
      (t) => fitsParty(t, item.partySize) && isFree(busyByTable.get(t.id), item.start, item.end),
    );
    if (table) occupy(table.id, item);
    else blocked.push({ start: item.start, end: item.end });
  }
  return { busyByTable, blocked };
}

/** Vrai si la fenêtre touche un élément qu'aucune table n'absorbe. */
export function isWindowBlocked(plan: SeatingPlan, start: Date, end: Date): boolean {
  return plan.blocked.some((b) => intervalsOverlap(b.start, b.end, start, end));
}

/** Vrai si une table compatible (dans la section demandée, le cas échéant) est libre sur la fenêtre. */
export function hasSeatFor(
  plan: SeatingPlan,
  tables: SeatingTable[],
  candidate: SeatingCandidate,
): boolean {
  return tables.some(
    (t) =>
      (!candidate.sectionId || t.sectionId === candidate.sectionId) &&
      fitsParty(t, candidate.partySize) &&
      isFree(plan.busyByTable.get(t.id), candidate.start, candidate.end),
  );
}

export async function loadSeatingTables(
  db: SeatingDb,
  restaurantId: string,
  defaultFloorOnly = false,
): Promise<SeatingTable[]> {
  return db.table.findMany({
    where: {
      isActive: true,
      floorPlan: {
        restaurantId,
        isActive: true,
        ...(defaultFloorOnly ? { isDefault: true } : {}),
      },
    },
    select: { id: true, sectionId: true, capacity: true, minCapacity: true },
  });
}

/**
 * Éléments du jour local `date` (et du lendemain, pour une fenêtre qui passe minuit), dans l'ordre
 * d'arrivée. Disponibilité et création appellent cette fonction avec le même jour : elles voient donc
 * les mêmes éléments.
 */
export async function loadSeatingItems(
  db: SeatingDb,
  args: {
    restaurantId: string;
    date: string;
    timeZone: string;
    serviceDurationMinutes: number;
    now: Date;
    excludeReservationId?: string;
    excludeHoldId?: string | null;
  },
): Promise<SeatingItem[]> {
  const dayStart = zonedTimeToUtc(args.date, '00:00', args.timeZone);
  const dayEnd = new Date(zonedTimeToUtc(args.date, '23:59:59.999', args.timeZone).getTime() + 1);
  const from = dayStart;
  const to = new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000);

  const [reservations, holds] = await Promise.all([
    db.reservation.findMany({
      where: {
        restaurantId: args.restaurantId,
        isTest: false,
        state: { in: [...ACTIVE_RESERVATION_STATES] },
        ...(args.excludeReservationId ? { id: { not: args.excludeReservationId } } : {}),
        OR: reservationOverlapWhere(from, to, args.serviceDurationMinutes),
      },
      select: {
        id: true,
        partySize: true,
        tableId: true,
        startsAt: true,
        endsAt: true,
        reservedAt: true,
        createdAt: true,
      },
    }),
    db.agenticHold.findMany({
      where: {
        restaurantId: args.restaurantId,
        type: 'HOLD',
        status: 'ACTIVE',
        expiresAt: { gt: args.now },
        ...(args.excludeHoldId ? { id: { not: args.excludeHoldId } } : {}),
        slotStart: { lt: to },
        slotEnd: { gt: from },
      },
      select: {
        id: true,
        partySize: true,
        tableId: true,
        slotStart: true,
        slotEnd: true,
        createdAt: true,
      },
    }),
  ]);

  const arrived = [
    ...reservations.map((r) => {
      const start = r.startsAt ?? r.reservedAt;
      const end = r.endsAt ?? new Date(start.getTime() + args.serviceDurationMinutes * 60_000);
      return {
        id: r.id,
        createdAt: r.createdAt,
        partySize: r.partySize,
        tableId: r.tableId,
        start,
        end,
      };
    }),
    ...holds.map((h) => ({
      id: h.id,
      createdAt: h.createdAt,
      partySize: h.partySize,
      tableId: h.tableId,
      start: h.slotStart,
      end: h.slotEnd,
    })),
  ];
  arrived.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return arrived.map(({ partySize, tableId, start, end }) => ({ partySize, tableId, start, end }));
}

/**
 * Verdict de création pour un groupe qui arrive maintenant, sur le même jeu d'éléments que la
 * disponibilité. Sans `tableId`, le groupe est placé en dernier ; avec `tableId`, la table est fixée.
 * `hasTables` dit si le restaurant a un plan de salle : sans plan, l'appelant garde ses anciennes
 * règles.
 */
export async function findUnassignedSeatingConflict(
  db: SeatingDb,
  args: {
    restaurantId: string;
    partySize: number;
    startsAt: Date;
    endsAt: Date;
    tableId?: string | null;
    now: Date;
    excludeReservationId?: string;
    excludeHoldId?: string | null;
  },
): Promise<{ conflict: boolean; hasTables: boolean }> {
  const [restaurant, settings, tables] = await Promise.all([
    db.restaurant.findUnique({ where: { id: args.restaurantId }, select: { timezone: true } }),
    db.restaurantExposureSettings.findUnique({
      where: { restaurantId: args.restaurantId },
      select: { capacitySpecials: true },
    }),
    loadSeatingTables(db, args.restaurantId),
  ]);
  const timeZone = restaurant?.timezone ?? DEFAULT_RESTAURANT_TIMEZONE;
  const items = await loadSeatingItems(db, {
    restaurantId: args.restaurantId,
    date: utcToZonedParts(args.startsAt, timeZone).date,
    timeZone,
    serviceDurationMinutes: resolveServiceDurationMinutes(settings?.capacitySpecials),
    now: args.now,
    excludeReservationId: args.excludeReservationId,
    excludeHoldId: args.excludeHoldId,
  });
  const window = { start: args.startsAt, end: args.endsAt };
  const hasTables = tables.length > 0;

  if (args.tableId) {
    const fixed: SeatingItem = { ...window, partySize: args.partySize, tableId: args.tableId };
    const plan = planUnassignedSeating(tables, [...items, fixed]);
    return { conflict: isWindowBlocked(plan, window.start, window.end), hasTables };
  }

  const plan = planUnassignedSeating(tables, items);
  // Sans plan de salle, aucune table à trouver : seul le blocage par intervalle compte.
  const conflict =
    isWindowBlocked(plan, window.start, window.end) ||
    (hasTables && !hasSeatFor(plan, tables, { ...window, partySize: args.partySize }));
  return { conflict, hasTables };
}
