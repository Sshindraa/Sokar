import {
  Prisma,
  type PrismaClient,
  type ReservationChannel,
  type ReservationState,
  type ReservationStatus,
  type WaitingListStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
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
  operationId: string;
  delayReportId?: string;
  idempotent?: boolean;
};

type DelayRecoveryRevertResult = {
  delayedReservationId: string;
  promotedReservationId: string;
  waitingListEntryId: string;
  operationId: string;
  delayReportId?: string;
  idempotent?: boolean;
};

type DelayRecoveryMetadata = {
  alternativeTableId?: unknown;
  delayMinutes?: unknown;
  waitingListEntryId?: unknown;
  promotedReservationId?: unknown;
  originalTableId?: unknown;
  originalStartsAt?: unknown;
  originalEndsAt?: unknown;
  appliedStartsAt?: unknown;
  appliedEndsAt?: unknown;
  promotedStartsAt?: unknown;
  promotedEndsAt?: unknown;
  idempotencyPayloadHash?: unknown;
  idempotencyVersion?: unknown;
  delayReportId?: unknown;
};

type DelayRecoveryApplyPayload = {
  reservationId: string;
  delayMinutes: number;
  alternativeTableId: string;
  waitingListEntryId: string;
  waitingListAcceptanceConfirmed: boolean;
  delayReportId?: string;
};

type ExistingDelayRecovery = DelayRecoveryResult & {
  payloadHash?: string;
  alternativeTableId?: string;
  delayMinutes?: number;
  waitingListEntryId?: string;
};

const DELAY_RECOVERY_IDEMPOTENCY_VERSION = 'v1';

/** Empreinte stable des données qui définissent une application de plan. */
export function computeDelayRecoveryPayloadHash(payload: DelayRecoveryApplyPayload): string {
  const canonicalPayload = {
    version: DELAY_RECOVERY_IDEMPOTENCY_VERSION,
    reservationId: payload.reservationId,
    delayMinutes: payload.delayMinutes,
    alternativeTableId: payload.alternativeTableId,
    waitingListEntryId: payload.waitingListEntryId,
    waitingListAcceptanceConfirmed: payload.waitingListAcceptanceConfirmed,
    delayReportId: payload.delayReportId ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
}

export type DelayRecoverySnapshot = {
  alternativeTableId: string;
  waitingListEntryId: string;
  promotedReservationId: string;
  originalTableId: string;
  originalStartsAt: Date;
  originalEndsAt: Date;
  appliedStartsAt: Date;
  appliedEndsAt: Date;
  promotedStartsAt: Date;
  promotedEndsAt: Date;
};

export function parseDelayRecoverySnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): DelayRecoverySnapshot | null {
  const value = metadata as DelayRecoveryMetadata | null | undefined;
  const stringKeys = [
    'alternativeTableId',
    'waitingListEntryId',
    'promotedReservationId',
    'originalTableId',
    'originalStartsAt',
    'originalEndsAt',
    'appliedStartsAt',
    'appliedEndsAt',
    'promotedStartsAt',
    'promotedEndsAt',
  ] as const;
  if (!value || stringKeys.some((key) => typeof value[key] !== 'string')) return null;
  const dates = {
    originalStartsAt: new Date(value.originalStartsAt as string),
    originalEndsAt: new Date(value.originalEndsAt as string),
    appliedStartsAt: new Date(value.appliedStartsAt as string),
    appliedEndsAt: new Date(value.appliedEndsAt as string),
    promotedStartsAt: new Date(value.promotedStartsAt as string),
    promotedEndsAt: new Date(value.promotedEndsAt as string),
  };
  if (Object.values(dates).some((date) => Number.isNaN(date.getTime()))) return null;
  return {
    alternativeTableId: value.alternativeTableId as string,
    waitingListEntryId: value.waitingListEntryId as string,
    promotedReservationId: value.promotedReservationId as string,
    originalTableId: value.originalTableId as string,
    ...dates,
  };
}

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
    const payloadHash = computeDelayRecoveryPayloadHash(args);
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
    if (existing) return this.asIdempotentResult(existing, args, payloadHash, operationId);
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
      if (existing) return this.asIdempotentResult(existing, args, payloadHash, operationId);

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
            originalTableId: originalTable.id,
            originalStartsAt: reservation.startsAt.toISOString(),
            originalEndsAt: reservation.endsAt.toISOString(),
            appliedStartsAt: proposedStartsAt.toISOString(),
            appliedEndsAt: proposedEndsAt.toISOString(),
            promotedStartsAt: promotedStartsAt.toISOString(),
            promotedEndsAt: promotedEndsAt.toISOString(),
            idempotencyPayloadHash: payloadHash,
            idempotencyVersion: DELAY_RECOVERY_IDEMPOTENCY_VERSION,
            delayReportId: args.delayReportId ?? null,
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

      return {
        delayedReservationId: delayed.id,
        promotedReservationId: promoted.id,
        operationId,
        ...(args.delayReportId ? { delayReportId: args.delayReportId } : {}),
      };
    });
  }

  /**
   * Annule un plan de récupération tant que ses deux réservations et son entrée
   * de liste d’attente sont encore exactement dans l’état créé par `apply`.
   * Toute intervention ultérieure rend le retour arrière dangereux et produit
   * un conflit explicite, sans écriture partielle.
   */
  async revert(args: {
    restaurantId: string;
    reservationId: string;
    operationId: string;
    actor: string;
  }): Promise<DelayRecoveryRevertResult> {
    const existing = await this.findExistingRevert(
      this.prisma,
      args.restaurantId,
      args.reservationId,
      args.operationId,
    );
    if (existing) return { ...existing, idempotent: true };

    const recovery = await this.prisma.reservationAuditLog.findFirst({
      where: {
        event: 'reservation_delay_recovered',
        reservationId: args.reservationId,
        correlationId: args.operationId,
        reservation: { restaurantId: args.restaurantId },
      },
      select: { metadata: true },
    });
    const snapshot = parseDelayRecoverySnapshot(recovery?.metadata);
    const delayReportId =
      typeof (recovery?.metadata as DelayRecoveryMetadata | null | undefined)?.delayReportId ===
      'string'
        ? ((recovery?.metadata as DelayRecoveryMetadata).delayReportId as string)
        : undefined;
    if (!snapshot) {
      throw new DelayRecoveryConflictError(
        'Ce plan ne contient pas les informations nécessaires pour être annulé en sécurité.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const reservationId of [args.reservationId, snapshot.promotedReservationId].sort()) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`,
        );
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM waiting_list_entries WHERE id = ${snapshot.waitingListEntryId} FOR UPDATE`,
      );
      for (const tableId of [snapshot.originalTableId, snapshot.alternativeTableId].sort()) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM floor_plan_tables WHERE id = ${tableId} FOR UPDATE`,
        );
      }

      const alreadyReverted = await this.findExistingRevert(
        tx,
        args.restaurantId,
        args.reservationId,
        args.operationId,
      );
      if (alreadyReverted) return { ...alreadyReverted, idempotent: true };

      const [delayed, promoted, entry, originalTable, alternativeTable] = await Promise.all([
        tx.reservation.findFirst({
          where: { id: args.reservationId, restaurantId: args.restaurantId },
        }),
        tx.reservation.findFirst({
          where: { id: snapshot.promotedReservationId, restaurantId: args.restaurantId },
        }),
        tx.waitingListEntry.findFirst({
          where: { id: snapshot.waitingListEntryId, restaurantId: args.restaurantId },
        }),
        tx.table.findFirst({
          where: {
            id: snapshot.originalTableId,
            isActive: true,
            floorPlan: { restaurantId: args.restaurantId, isActive: true },
          },
        }),
        tx.table.findFirst({
          where: {
            id: snapshot.alternativeTableId,
            isActive: true,
            floorPlan: { restaurantId: args.restaurantId, isActive: true },
          },
        }),
      ]);

      const unchanged =
        delayed?.state === ('CONFIRMED' as ReservationState) &&
        delayed.tableId === snapshot.alternativeTableId &&
        delayed.startsAt?.getTime() === snapshot.appliedStartsAt.getTime() &&
        delayed.endsAt?.getTime() === snapshot.appliedEndsAt.getTime() &&
        promoted?.state === ('CONFIRMED' as ReservationState) &&
        promoted.status === ('CONFIRMED' as ReservationStatus) &&
        promoted.source === 'service_copilot_delay_recovery' &&
        promoted.tableId === snapshot.originalTableId &&
        promoted.startsAt?.getTime() === snapshot.promotedStartsAt.getTime() &&
        promoted.endsAt?.getTime() === snapshot.promotedEndsAt.getTime() &&
        entry?.status === ('PROMOTED' as WaitingListStatus) &&
        entry.promotedReservationId === snapshot.promotedReservationId &&
        entry.expiresAt.getTime() > Date.now() &&
        originalTable &&
        alternativeTable;
      if (!unchanged) {
        throw new DelayRecoveryConflictError(
          'Le plan a évolué depuis son application. Corrigez la situation manuellement.',
        );
      }

      const originalTableIsFree = await this.allocation.isTableAvailable(
        {
          tableId: snapshot.originalTableId,
          startsAt: snapshot.originalStartsAt,
          endsAt: snapshot.originalEndsAt,
          excludeReservationId: snapshot.promotedReservationId,
        },
        tx,
      );
      if (!originalTableIsFree) {
        throw new DelayRecoveryConflictError(
          'La table initiale est désormais occupée. Le plan ne peut pas être annulé automatiquement.',
        );
      }

      await tx.reservation.update({
        where: { id: delayed.id },
        data: {
          tableId: snapshot.originalTableId,
          startsAt: snapshot.originalStartsAt,
          endsAt: snapshot.originalEndsAt,
        },
      });
      await tx.reservation.update({
        where: { id: promoted.id },
        data: {
          state: 'CANCELLED' as ReservationState,
          status: 'CANCELLED' as ReservationStatus,
        },
      });
      await tx.waitingListEntry.update({
        where: { id: entry.id },
        data: {
          status: 'PENDING' as WaitingListStatus,
          promotedReservationId: null,
          promotedAt: null,
        },
      });
      await this.audit.record(
        {
          event: 'reservation_delay_recovery_reverted',
          reservationId: delayed.id,
          actor: args.actor,
          correlationId: `revert:${args.operationId}`,
          metadata: {
            operationId: args.operationId,
            restoredTableId: snapshot.originalTableId,
            restoredStartsAt: snapshot.originalStartsAt.toISOString(),
            restoredEndsAt: snapshot.originalEndsAt.toISOString(),
            promotedReservationId: promoted.id,
            waitingListEntryId: entry.id,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          event: 'reservation_cancelled',
          reservationId: promoted.id,
          actor: args.actor,
          fromState: 'CONFIRMED',
          toState: 'CANCELLED',
          correlationId: `revert:${args.operationId}`,
          metadata: { reason: 'delay_recovery_reverted' },
        },
        tx,
      );
      await this.audit.record(
        {
          event: 'waiting_list_restored',
          reservationId: promoted.id,
          actor: args.actor,
          correlationId: `revert:${args.operationId}`,
          metadata: { entryId: entry.id, reason: 'delay_recovery_reverted' },
        },
        tx,
      );

      return {
        delayedReservationId: delayed.id,
        promotedReservationId: promoted.id,
        waitingListEntryId: entry.id,
        operationId: args.operationId,
        ...(delayReportId ? { delayReportId } : {}),
      };
    });
  }

  private async findExistingRecovery(
    client: PrismaClient | Prisma.TransactionClient,
    restaurantId: string,
    reservationId: string,
    operationId: string,
  ): Promise<ExistingDelayRecovery | null> {
    const recovery = await client.reservationAuditLog.findFirst({
      where: {
        event: 'reservation_delay_recovered',
        reservationId,
        correlationId: operationId,
        reservation: { restaurantId },
      },
      select: { metadata: true },
    });
    const metadata = recovery?.metadata as DelayRecoveryMetadata | null | undefined;
    return recovery && typeof metadata?.promotedReservationId === 'string'
      ? {
          delayedReservationId: reservationId,
          promotedReservationId: metadata.promotedReservationId,
          operationId,
          payloadHash:
            typeof metadata.idempotencyPayloadHash === 'string'
              ? metadata.idempotencyPayloadHash
              : undefined,
          alternativeTableId:
            typeof metadata.alternativeTableId === 'string'
              ? metadata.alternativeTableId
              : undefined,
          delayMinutes:
            typeof metadata.delayMinutes === 'number' ? metadata.delayMinutes : undefined,
          waitingListEntryId:
            typeof metadata.waitingListEntryId === 'string'
              ? metadata.waitingListEntryId
              : undefined,
        }
      : null;
  }

  private asIdempotentResult(
    existing: ExistingDelayRecovery,
    args: DelayRecoveryApplyPayload,
    payloadHash: string,
    operationId: string,
  ): DelayRecoveryResult {
    const isCurrentPayload = existing.payloadHash
      ? existing.payloadHash === payloadHash
      : existing.alternativeTableId === args.alternativeTableId &&
        existing.delayMinutes === args.delayMinutes &&
        existing.waitingListEntryId === args.waitingListEntryId &&
        args.waitingListAcceptanceConfirmed;
    if (!isCurrentPayload) {
      throw new DelayRecoveryConflictError(
        'Cette clé d’action a déjà été utilisée pour un autre plan. Rechargez l’analyse avant de continuer.',
      );
    }
    return {
      delayedReservationId: existing.delayedReservationId,
      promotedReservationId: existing.promotedReservationId,
      operationId,
      idempotent: true,
    };
  }

  private async findExistingRevert(
    client: PrismaClient | Prisma.TransactionClient,
    restaurantId: string,
    reservationId: string,
    operationId: string,
  ): Promise<DelayRecoveryRevertResult | null> {
    const revert = await client.reservationAuditLog.findFirst({
      where: {
        event: 'reservation_delay_recovery_reverted',
        reservationId,
        correlationId: `revert:${operationId}`,
        reservation: { restaurantId },
      },
      select: { metadata: true },
    });
    const metadata = revert?.metadata as
      | { promotedReservationId?: unknown; waitingListEntryId?: unknown }
      | null
      | undefined;
    return revert &&
      typeof metadata?.promotedReservationId === 'string' &&
      typeof metadata.waitingListEntryId === 'string'
      ? {
          delayedReservationId: reservationId,
          promotedReservationId: metadata.promotedReservationId,
          waitingListEntryId: metadata.waitingListEntryId,
          operationId,
        }
      : null;
  }
}
