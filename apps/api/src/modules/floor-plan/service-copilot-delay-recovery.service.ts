import {
  Prisma,
  type PrismaClient,
  type ReservationChannel,
  type ReservationState,
  type ReservationStatus,
  type WaitingListStatus,
} from '@prisma/client';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { TableAllocationService } from './table-allocation.service';
import { ServiceCopilotDelayImpactService } from './service-copilot-delay-impact.service';

export class DelayRecoveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelayRecoveryConflictError';
  }
}

type DelayRecoveryResult = {
  delayedReservationId: string;
  promotedReservationId: string;
  idempotent?: boolean;
};

/**
 * Applique un plan de récupération précédemment présenté au responsable.
 *
 * Le navigateur ne fournit que les choix à confirmer. Le serveur recalcule le
 * plan, verrouille les deux tables et les deux enregistrements, puis revalide
 * les conflits avant la moindre écriture. Toute divergence rend un 409.
 */
export class ServiceCopilotDelayRecoveryService {
  private readonly allocation: TableAllocationService;
  private readonly audit: AuditLogService;

  constructor(private readonly prisma: PrismaClient) {
    this.allocation = new TableAllocationService(prisma);
    this.audit = new AuditLogService(prisma);
  }

  async apply(args: {
    restaurantId: string;
    reservationId: string;
    delayMinutes: number;
    alternativeTableId: string;
    waitingListEntryId: string;
    actor: string;
    waitingListAcceptanceConfirmed: boolean;
    delayReportId?: string;
    idempotencyKey?: string;
  }): Promise<DelayRecoveryResult> {
    const operationId =
      args.delayReportId ??
      args.idempotencyKey ??
      `delay-recovery:${args.reservationId}:${args.delayMinutes}:${args.alternativeTableId}:${args.waitingListEntryId}`;
    const existing = await this.findExistingRecovery(
      this.prisma,
      args.restaurantId,
      args.reservationId,
      operationId,
    );
    if (existing) return { ...existing, idempotent: true };
    if (!args.waitingListAcceptanceConfirmed) {
      throw new DelayRecoveryConflictError(
        'Confirmez que le groupe de la liste d’attente est présent et accepte la table.',
      );
    }
    if (args.delayReportId) {
      const report = await this.prisma.reservationAuditLog.findFirst({
        where: {
          id: args.delayReportId,
          event: 'reservation_delay_reported',
          reservationId: args.reservationId,
          reservation: { restaurantId: args.restaurantId },
        },
        select: { metadata: true },
      });
      const reportedDelay = (report?.metadata as { delayMinutes?: unknown } | null)?.delayMinutes;
      if (!report || reportedDelay !== args.delayMinutes) {
        throw new DelayRecoveryConflictError(
          'Ce plan ne correspond plus au retard signalé. Relancez l’analyse.',
        );
      }
    }
    const preflight = await new ServiceCopilotDelayImpactService(this.prisma).simulate({
      restaurantId: args.restaurantId,
      reservationId: args.reservationId,
      delayMinutes: args.delayMinutes,
    });
    if (
      !preflight.feasible ||
      preflight.alternativeTable?.id !== args.alternativeTableId ||
      preflight.waitingListEntry?.id !== args.waitingListEntryId
    ) {
      throw new DelayRecoveryConflictError(
        'Le plan a changé depuis son analyse. Relancez la simulation avant de confirmer.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM reservations WHERE id = ${args.reservationId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM waiting_list_entries WHERE id = ${args.waitingListEntryId} FOR UPDATE`,
      );

      const existing = await this.findExistingRecovery(
        tx,
        args.restaurantId,
        args.reservationId,
        operationId,
      );
      if (existing) return { ...existing, idempotent: true };

      const reservation = await tx.reservation.findFirst({
        where: {
          id: args.reservationId,
          restaurantId: args.restaurantId,
          state: 'CONFIRMED' as ReservationState,
          tableId: { not: null },
          startsAt: { not: null },
          endsAt: { not: null },
        },
      });
      const entry = await tx.waitingListEntry.findFirst({
        where: {
          id: args.waitingListEntryId,
          restaurantId: args.restaurantId,
          status: 'PENDING' as WaitingListStatus,
          expiresAt: { gt: new Date() },
        },
      });
      if (!reservation?.tableId || !reservation.startsAt || !reservation.endsAt || !entry) {
        throw new DelayRecoveryConflictError(
          'Le retard, la réservation ou la liste d’attente a changé.',
        );
      }

      const tableIds = [reservation.tableId, args.alternativeTableId].sort();
      for (const tableId of tableIds) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM floor_plan_tables WHERE id = ${tableId} FOR UPDATE`,
        );
      }

      const [originalTable, alternativeTable] = await Promise.all([
        tx.table.findFirst({
          where: {
            id: reservation.tableId,
            isActive: true,
            floorPlan: { restaurantId: args.restaurantId, isActive: true },
          },
        }),
        tx.table.findFirst({
          where: {
            id: args.alternativeTableId,
            isActive: true,
            floorPlan: { restaurantId: args.restaurantId, isActive: true },
          },
        }),
      ]);
      if (!originalTable || !alternativeTable || alternativeTable.id === originalTable.id) {
        throw new DelayRecoveryConflictError('La table proposée n’est plus disponible.');
      }
      if (
        alternativeTable.capacity < reservation.partySize ||
        alternativeTable.minCapacity > reservation.partySize ||
        originalTable.capacity < entry.partySize ||
        originalTable.minCapacity > entry.partySize ||
        (entry.preferredSectionId && entry.preferredSectionId !== originalTable.sectionId)
      ) {
        throw new DelayRecoveryConflictError('Les capacités des tables ne correspondent plus.');
      }

      const proposedStartsAt = new Date(
        reservation.startsAt.getTime() + args.delayMinutes * 60_000,
      );
      const proposedEndsAt = new Date(reservation.endsAt.getTime() + args.delayMinutes * 60_000);
      const promotedStartsAt = new Date(preflight.waitingListEntry!.proposedStartsAt);
      const promotedEndsAt = new Date(preflight.waitingListEntry!.proposedEndsAt);
      const [alternativeIsFree, originalIsFree] = await Promise.all([
        this.allocation.isTableAvailable(
          {
            tableId: alternativeTable.id,
            startsAt: proposedStartsAt,
            endsAt: proposedEndsAt,
            excludeReservationId: reservation.id,
          },
          tx,
        ),
        this.allocation.isTableAvailable(
          {
            tableId: originalTable.id,
            startsAt: promotedStartsAt,
            endsAt: promotedEndsAt,
            excludeReservationId: reservation.id,
          },
          tx,
        ),
      ]);
      if (!alternativeIsFree || !originalIsFree) {
        throw new DelayRecoveryConflictError('Un conflit est apparu pendant la confirmation.');
      }

      const delayed = await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          tableId: alternativeTable.id,
          startsAt: proposedStartsAt,
          endsAt: proposedEndsAt,
        },
      });
      const promoted = await tx.reservation.create({
        data: {
          restaurantId: entry.restaurantId,
          partySize: entry.partySize,
          customerName: `${entry.customerFirstName} ${entry.customerLastName ?? ''}`.trim(),
          customerPhone: entry.customerPhone,
          customerEmail: entry.customerEmail,
          reservedAt: new Date(),
          startsAt: promotedStartsAt,
          endsAt: promotedEndsAt,
          tableId: originalTable.id,
          state: 'CONFIRMED' as ReservationState,
          status: 'CONFIRMED' as ReservationStatus,
          channel: 'ADMIN' as ReservationChannel,
          source: 'service_copilot_delay_recovery',
          privacyPolicyVersion: '2026-06-20',
          consents: {},
        },
      });
      await tx.waitingListEntry.update({
        where: { id: entry.id },
        data: {
          status: 'PROMOTED' as WaitingListStatus,
          promotedReservationId: promoted.id,
          promotedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          event: 'reservation_delay_recovered',
          reservationId: delayed.id,
          actor: args.actor,
          correlationId: operationId,
          metadata: {
            alternativeTableId: alternativeTable.id,
            delayMinutes: args.delayMinutes,
            waitingListEntryId: entry.id,
            promotedReservationId: promoted.id,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          event: 'waiting_list_promoted',
          reservationId: promoted.id,
          actor: args.actor,
          metadata: { entryId: entry.id, tableId: originalTable.id, reason: 'delay_recovery' },
        },
        tx,
      );

      return { delayedReservationId: delayed.id, promotedReservationId: promoted.id };
    });
  }

  private async findExistingRecovery(
    client: PrismaClient | Prisma.TransactionClient,
    restaurantId: string,
    reservationId: string,
    operationId: string,
  ): Promise<DelayRecoveryResult | null> {
    const recovery = await client.reservationAuditLog.findFirst({
      where: {
        event: 'reservation_delay_recovered',
        reservationId,
        correlationId: operationId,
        reservation: { restaurantId },
      },
      select: { metadata: true },
    });
    const metadata = recovery?.metadata as { promotedReservationId?: unknown } | null | undefined;
    return recovery && typeof metadata?.promotedReservationId === 'string'
      ? {
          delayedReservationId: reservationId,
          promotedReservationId: metadata.promotedReservationId,
        }
      : null;
  }
}
