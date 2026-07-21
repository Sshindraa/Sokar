import type {
  PrismaClient,
  ReservationState,
  ReservationStatus,
  WaitingListStatus,
} from '@prisma/client';
import { zonedTimeToUtc } from './availability-capacity-aware.service';
import {
  parseDelayRecoverySnapshot,
  type DelayRecoverySnapshot,
} from './service-copilot-delay-recovery.service';

export type DelayRecoveryHistoryStatus = 'applied' | 'reverted' | 'blocked';

export type DelayRecoveryHistoryItem = {
  operationId: string;
  delayedReservationId: string;
  promotedReservationId: string;
  waitingListEntryId: string;
  delayedCustomerName: string;
  waitingCustomerName: string;
  originalTableName: string;
  alternativeTableName: string;
  delayMinutes: number;
  originalStartsAt: string;
  appliedStartsAt: string;
  appliedAt: string;
  revertedAt?: string;
  status: DelayRecoveryHistoryStatus;
  revertible: boolean;
  blockedReason?: string;
};

function formatLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function unchangedReason(args: {
  snapshot: DelayRecoverySnapshot;
  delayed?: {
    state: ReservationState;
    tableId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
  };
  promoted?: {
    state: ReservationState;
    status: ReservationStatus;
    source: string | null;
    tableId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
  };
  entry?: {
    status: WaitingListStatus;
    promotedReservationId: string | null;
    expiresAt: Date;
  };
  originalTableActive: boolean;
  alternativeTableActive: boolean;
  now: Date;
}): string | undefined {
  const { snapshot, delayed, promoted, entry } = args;
  if (
    !delayed ||
    delayed.state !== 'CONFIRMED' ||
    delayed.tableId !== snapshot.alternativeTableId ||
    delayed.startsAt?.getTime() !== snapshot.appliedStartsAt.getTime() ||
    delayed.endsAt?.getTime() !== snapshot.appliedEndsAt.getTime()
  ) {
    return 'La réservation retardée a été modifiée.';
  }
  if (
    !promoted ||
    promoted.state !== 'CONFIRMED' ||
    promoted.status !== 'CONFIRMED' ||
    promoted.source !== 'service_copilot_delay_recovery' ||
    promoted.tableId !== snapshot.originalTableId ||
    promoted.startsAt?.getTime() !== snapshot.promotedStartsAt.getTime() ||
    promoted.endsAt?.getTime() !== snapshot.promotedEndsAt.getTime()
  ) {
    return 'Le groupe promu a déjà été modifié ou installé.';
  }
  if (
    !entry ||
    entry.status !== 'PROMOTED' ||
    entry.promotedReservationId !== snapshot.promotedReservationId
  ) {
    return 'La liste d’attente a été modifiée.';
  }
  if (entry.expiresAt.getTime() <= args.now.getTime()) {
    return 'L’entrée de liste d’attente a expiré.';
  }
  if (!args.originalTableActive || !args.alternativeTableActive) {
    return 'Une table ou un plan de salle n’est plus actif.';
  }
  return undefined;
}

/** Reconstruit l’historique depuis les audits append-only, sans nouvelle table métier. */
export class ServiceCopilotDelayRecoveryHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(args: {
    restaurantId: string;
    date: string;
    limit?: number;
    now?: Date;
  }): Promise<DelayRecoveryHistoryItem[]> {
    const now = args.now ?? new Date();
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: args.restaurantId },
      select: { timezone: true },
    });
    const timeZone = restaurant?.timezone ?? 'Europe/Paris';
    const dayStart = zonedTimeToUtc(args.date, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(args.date, '23:59', timeZone);
    const auditWindowStart = new Date(dayStart.getTime() - 24 * 60 * 60_000);
    const auditWindowEnd = new Date(dayEnd.getTime() + 24 * 60 * 60_000);

    const recoveries = await this.prisma.reservationAuditLog.findMany({
      where: {
        event: 'reservation_delay_recovered',
        reservation: { restaurantId: args.restaurantId },
        OR: [
          { reservation: { startsAt: { gte: dayStart, lte: dayEnd } } },
          { createdAt: { gte: auditWindowStart, lte: auditWindowEnd } },
        ],
      },
      select: {
        reservationId: true,
        correlationId: true,
        metadata: true,
        createdAt: true,
        reservation: {
          select: {
            customerName: true,
            state: true,
            tableId: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const parsed = recoveries.flatMap((recovery) => {
      const snapshot = parseDelayRecoverySnapshot(recovery.metadata);
      return recovery.reservationId && recovery.correlationId && snapshot
        ? [{ recovery, snapshot, operationId: recovery.correlationId }]
        : [];
    });
    const forDate = parsed
      .filter(({ snapshot }) => formatLocalDate(snapshot.originalStartsAt, timeZone) === args.date)
      .slice(0, args.limit ?? 10);
    if (forDate.length === 0) return [];

    const promotedIds = forDate.map(({ snapshot }) => snapshot.promotedReservationId);
    const waitingIds = forDate.map(({ snapshot }) => snapshot.waitingListEntryId);
    const tableIds = forDate.flatMap(({ snapshot }) => [
      snapshot.originalTableId,
      snapshot.alternativeTableId,
    ]);
    const revertCorrelationIds = forDate.map(({ operationId }) => `revert:${operationId}`);
    const [promotedReservations, waitingEntries, tables, reverts] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { id: { in: promotedIds }, restaurantId: args.restaurantId },
        select: {
          id: true,
          customerName: true,
          state: true,
          status: true,
          source: true,
          tableId: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      this.prisma.waitingListEntry.findMany({
        where: { id: { in: waitingIds }, restaurantId: args.restaurantId },
        select: {
          id: true,
          customerFirstName: true,
          customerLastName: true,
          status: true,
          promotedReservationId: true,
          expiresAt: true,
        },
      }),
      this.prisma.table.findMany({
        where: {
          id: { in: tableIds },
          floorPlan: { restaurantId: args.restaurantId },
        },
        select: { id: true, name: true, isActive: true, floorPlan: { select: { isActive: true } } },
      }),
      this.prisma.reservationAuditLog.findMany({
        where: {
          event: 'reservation_delay_recovery_reverted',
          correlationId: { in: revertCorrelationIds },
          reservation: { restaurantId: args.restaurantId },
        },
        select: { correlationId: true, createdAt: true },
      }),
    ]);
    const promotedById = new Map(promotedReservations.map((item) => [item.id, item]));
    const waitingById = new Map(waitingEntries.map((item) => [item.id, item]));
    const tableById = new Map(tables.map((item) => [item.id, item]));
    const revertByCorrelationId = new Map(
      reverts.flatMap((item) =>
        item.correlationId ? [[item.correlationId, item.createdAt] as const] : [],
      ),
    );

    return forDate.map(({ recovery, snapshot, operationId }) => {
      const promoted = promotedById.get(snapshot.promotedReservationId);
      const entry = waitingById.get(snapshot.waitingListEntryId);
      const originalTable = tableById.get(snapshot.originalTableId);
      const alternativeTable = tableById.get(snapshot.alternativeTableId);
      const revertedAt = revertByCorrelationId.get(`revert:${operationId}`);
      const blockedReason = revertedAt
        ? undefined
        : unchangedReason({
            snapshot,
            delayed: recovery.reservation ?? undefined,
            promoted,
            entry,
            originalTableActive: Boolean(
              originalTable?.isActive && originalTable.floorPlan.isActive,
            ),
            alternativeTableActive: Boolean(
              alternativeTable?.isActive && alternativeTable.floorPlan.isActive,
            ),
            now,
          });
      const waitingCustomerName =
        promoted?.customerName ??
        ([entry?.customerFirstName, entry?.customerLastName].filter(Boolean).join(' ') ||
          'Groupe en attente');
      return {
        operationId,
        delayedReservationId: recovery.reservationId!,
        promotedReservationId: snapshot.promotedReservationId,
        waitingListEntryId: snapshot.waitingListEntryId,
        delayedCustomerName: recovery.reservation?.customerName ?? 'Client',
        waitingCustomerName,
        originalTableName: originalTable?.name ?? 'Table initiale',
        alternativeTableName: alternativeTable?.name ?? 'Table alternative',
        delayMinutes: Math.round(
          (snapshot.appliedStartsAt.getTime() - snapshot.originalStartsAt.getTime()) / 60_000,
        ),
        originalStartsAt: snapshot.originalStartsAt.toISOString(),
        appliedStartsAt: snapshot.appliedStartsAt.toISOString(),
        appliedAt: recovery.createdAt.toISOString(),
        revertedAt: revertedAt?.toISOString(),
        status: revertedAt ? 'reverted' : blockedReason ? 'blocked' : 'applied',
        revertible: !revertedAt && !blockedReason,
        blockedReason,
      };
    });
  }
}
