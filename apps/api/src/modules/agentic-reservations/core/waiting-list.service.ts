/**
 * WaitingListService — gestion de la file d'attente restaurant (P3.2).
 *
 * - join() crée une entrée PENDING avec un token d'action et une position.
 * - cancelByToken() annule une entrée via son token.
 * - promoteEntry() convertit une entrée PENDING en réservation si une table
 *   compatible est disponible.
 * - expireEntry() / cleanupExpired() marquent les entrées dépassées EXPIRED.
 */

import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient, type Reservation, type WaitingListEntry } from '@prisma/client';
import type { WaitingListStatus } from '@prisma/client';
import type { ReservationState, ReservationStatus, ReservationChannel } from '@prisma/client';
import { normalizePhone } from '@sokar/shared';
import { TableAllocationService } from '../../floor-plan/table-allocation.service.js';
import { resolveServiceDurationMinutes } from '../../floor-plan/floor-plan.types.js';
import { zonedTimeToUtc } from '../../floor-plan/availability-capacity-aware.service.js';
import { AuditLogService } from './audit-log.service.js';
import {
  scheduleWaitingListExpiration,
  scheduleWaitingListPromotionNotification,
} from '../workers/queues.js';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../../shared/db/transaction-options.js';
import {
  WaitingListAlreadyExistsError,
  WaitingListAlreadyPromotedError,
  WaitingListDisabledError,
  WaitingListEntryNotFoundError,
  WaitingListSlotFullError,
} from './waiting-list.errors.js';

function hashActionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateActionToken(): string {
  return randomBytes(32).toString('base64url');
}

export class WaitingListService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tableAllocation: TableAllocationService,
    private readonly audit: AuditLogService,
  ) {}

  async join(args: {
    restaurantId: string;
    partySize: number;
    customerFirstName: string;
    customerLastName?: string | null;
    customerPhone: string;
    customerEmail?: string | null;
    slotStart: Date;
    preferredSectionId?: string | null;
    source: string;
    waitingListEnabled: boolean;
    waitingListMaxEntriesPerSlot: number;
    serviceDurationMinutes?: number;
  }): Promise<{ entry: WaitingListEntry; actionToken: string }> {
    if (!args.waitingListEnabled) {
      throw new WaitingListDisabledError();
    }

    const serviceDurationMinutes = resolveServiceDurationMinutes(
      args.serviceDurationMinutes !== undefined
        ? { serviceDurationMinutes: args.serviceDurationMinutes }
        : {},
    );
    const slotEnd = new Date(args.slotStart.getTime() + serviceDurationMinutes * 60_000);
    const customerPhoneNormalized = normalizePhone(args.customerPhone);
    const lockKey = `${args.restaurantId}:${args.slotStart.toISOString()}`;

    let actionToken: string;

    try {
      const entry = await this.prisma.$transaction<WaitingListEntry>(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const pendingCount = await tx.waitingListEntry.count({
          where: {
            restaurantId: args.restaurantId,
            slotStart: args.slotStart,
            status: 'PENDING' as WaitingListStatus,
            expiresAt: { gt: new Date() },
          },
        });

        if (pendingCount >= args.waitingListMaxEntriesPerSlot) {
          throw new WaitingListSlotFullError(
            args.restaurantId,
            args.slotStart,
            args.waitingListMaxEntriesPerSlot,
          );
        }

        actionToken = generateActionToken();
        const actionTokenHash = hashActionToken(actionToken);

        const created = await tx.waitingListEntry.create({
          data: {
            restaurantId: args.restaurantId,
            partySize: args.partySize,
            customerFirstName: args.customerFirstName,
            customerLastName: args.customerLastName ?? null,
            customerPhone: args.customerPhone,
            customerPhoneNormalized,
            customerEmail: args.customerEmail ?? null,
            source: args.source,
            slotStart: args.slotStart,
            slotEnd,
            preferredSectionId: args.preferredSectionId ?? null,
            status: 'PENDING' as WaitingListStatus,
            position: pendingCount + 1,
            actionTokenHash,
            expiresAt: args.slotStart,
          },
        });

        await this.audit.record(
          {
            event: 'waiting_list_created',
            reservationId: null,
            actor: args.source ? `waiting-list:${args.source}` : 'waiting-list',
            metadata: {
              restaurantId: args.restaurantId,
              partySize: args.partySize,
              slotStart: args.slotStart.toISOString(),
              position: created.position,
            },
          },
          tx,
        );

        return created;
      }, DEFAULT_TRANSACTION_OPTIONS);

      await scheduleWaitingListExpiration({
        entryId: entry.id,
        expiresAt: entry.expiresAt,
      });

      return { entry, actionToken: actionToken! };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new WaitingListAlreadyExistsError(
          args.restaurantId,
          customerPhoneNormalized,
          args.slotStart,
        );
      }
      throw err;
    }
  }

  async cancelByToken(args: {
    entryId: string;
    actionToken: string;
    restaurantId: string;
  }): Promise<WaitingListEntry> {
    const actionTokenHash = hashActionToken(args.actionToken);

    return this.prisma.$transaction<WaitingListEntry>(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT * FROM waiting_list_entries WHERE id = ${args.entryId} FOR UPDATE`,
      );

      const entry = await tx.waitingListEntry.findUnique({
        where: { id: args.entryId },
      });

      if (
        !entry ||
        entry.restaurantId !== args.restaurantId ||
        entry.actionTokenHash !== actionTokenHash
      ) {
        throw new WaitingListEntryNotFoundError(args.entryId);
      }

      if (entry.status === 'CANCELLED' || entry.status === 'EXPIRED') {
        return entry;
      }

      if (entry.status === 'PROMOTED') {
        throw new WaitingListAlreadyPromotedError(entry.id);
      }

      await tx.waitingListEntry.update({
        where: { id: entry.id },
        data: {
          status: 'CANCELLED' as WaitingListStatus,
          cancelledAt: new Date(),
        },
      });

      await this.audit.record(
        {
          event: 'waiting_list_cancelled',
          reservationId: null,
          actor: 'system:waiting-list',
          metadata: {
            restaurantId: args.restaurantId,
            entryId: entry.id,
          },
        },
        tx,
      );

      return tx.waitingListEntry.findUniqueOrThrow({ where: { id: entry.id } });
    }, DEFAULT_TRANSACTION_OPTIONS);
  }

  async promoteEntry(
    entryId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<Reservation | null> {
    const doPromote = async (prisma: Prisma.TransactionClient): Promise<Reservation | null> => {
      await prisma.$queryRaw(
        Prisma.sql`SELECT * FROM waiting_list_entries WHERE id = ${entryId} FOR UPDATE`,
      );

      const entry = await prisma.waitingListEntry.findUnique({ where: { id: entryId } });
      if (!entry) {
        return null;
      }

      if (entry.status === 'PROMOTED' && entry.promotedReservationId) {
        const existing = await prisma.reservation.findUnique({
          where: { id: entry.promotedReservationId },
        });
        return existing ?? null;
      }

      if (entry.status !== 'PENDING' || entry.expiresAt.getTime() <= Date.now()) {
        return null;
      }

      const table = await this.tableAllocation.allocate(
        {
          restaurantId: entry.restaurantId,
          partySize: entry.partySize,
          startsAt: entry.slotStart,
          endsAt: entry.slotEnd,
          preferredSectionId: entry.preferredSectionId ?? undefined,
        },
        prisma,
      );

      if (!table) {
        return null;
      }

      const reservation = await prisma.reservation.create({
        data: {
          restaurantId: entry.restaurantId,
          partySize: entry.partySize,
          customerName: `${entry.customerFirstName} ${entry.customerLastName ?? ''}`.trim(),
          customerPhone: entry.customerPhone,
          customerEmail: entry.customerEmail,
          reservedAt: new Date(),
          startsAt: entry.slotStart,
          endsAt: entry.slotEnd,
          tableId: table.id,
          state: 'CONFIRMED' as ReservationState,
          status: 'CONFIRMED' as ReservationStatus,
          channel: 'WEB' as ReservationChannel,
          source: 'waiting_list',
          privacyPolicyVersion: '2026-06-20',
          consents: {},
        },
      });

      await prisma.waitingListEntry.update({
        where: { id: entry.id },
        data: {
          status: 'PROMOTED' as WaitingListStatus,
          promotedReservationId: reservation.id,
          promotedAt: new Date(),
        },
      });

      await this.audit.record(
        {
          event: 'waiting_list_promoted',
          reservationId: reservation.id,
          actor: 'system:waiting-list',
          metadata: {
            restaurantId: entry.restaurantId,
            entryId: entry.id,
            tableId: table.id,
          },
        },
        prisma,
      );

      return reservation;
    };

    if (outerTx) {
      // When called inside an outer transaction, the caller is responsible for scheduling the promotion notification after commit.
      return doPromote(outerTx);
    }

    const reservation = await this.prisma.$transaction(doPromote, DEFAULT_TRANSACTION_OPTIONS);
    if (reservation) {
      await scheduleWaitingListPromotionNotification({
        entryId,
        reservationId: reservation.id,
      });
    }
    return reservation;
  }

  async expireEntry(entryId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const prisma = tx ?? this.prisma;
    const now = new Date();

    await prisma.waitingListEntry.updateMany({
      where: {
        id: entryId,
        expiresAt: { lte: now },
        status: 'PENDING' as WaitingListStatus,
      },
      data: { status: 'EXPIRED' as WaitingListStatus },
    });
  }

  async cleanupExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.waitingListEntry.updateMany({
      where: {
        status: 'PENDING' as WaitingListStatus,
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED' as WaitingListStatus },
    });

    return result.count;
  }

  async cancelByStaff(entryId: string, restaurantId: string): Promise<WaitingListEntry> {
    return this.prisma.$transaction<WaitingListEntry>(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT * FROM waiting_list_entries WHERE id = ${entryId} FOR UPDATE`,
      );

      const entry = await tx.waitingListEntry.findUnique({
        where: { id: entryId },
      });

      if (!entry || entry.restaurantId !== restaurantId) {
        throw new WaitingListEntryNotFoundError(entryId);
      }

      if (entry.status === 'CANCELLED' || entry.status === 'EXPIRED') {
        return entry;
      }

      await tx.waitingListEntry.update({
        where: { id: entry.id },
        data: {
          status: 'CANCELLED' as WaitingListStatus,
          cancelledAt: new Date(),
        },
      });

      await this.audit.record(
        {
          event: 'waiting_list_cancelled_by_staff',
          reservationId: entry.promotedReservationId,
          actor: 'staff:dashboard',
          metadata: {
            restaurantId,
            entryId: entry.id,
            previousStatus: entry.status,
          },
        },
        tx,
      );

      return tx.waitingListEntry.findUniqueOrThrow({ where: { id: entry.id } });
    }, DEFAULT_TRANSACTION_OPTIONS);
  }

  async list(args: {
    restaurantId: string;
    date?: string;
    status?: WaitingListStatus;
    timeZone?: string;
  }): Promise<WaitingListEntry[]> {
    const timeZone = args.timeZone ?? 'Europe/Paris';
    const where: Prisma.WaitingListEntryWhereInput = {
      restaurantId: args.restaurantId,
    };

    if (args.status) {
      where.status = args.status;
    }

    if (args.date) {
      const dayStart = zonedTimeToUtc(args.date, '00:00', timeZone);
      const dayEndBase = zonedTimeToUtc(args.date, '23:59', timeZone);
      const dayEnd = new Date(dayEndBase.getTime() + 59_999);
      where.slotStart = { gte: dayStart, lt: dayEnd };
    }

    const rows = await this.prisma.waitingListEntry.findMany({
      where,
      orderBy: [{ slotStart: 'asc' }, { createdAt: 'asc' }],
      include: { preferredSection: { select: { name: true } } },
    });

    return rows as unknown as WaitingListEntry[];
  }

  async findCompatibleCandidates(
    args: {
      restaurantId: string;
      slotStart: Date;
      timeZone?: string;
    },
    limit = 20,
  ): Promise<
    Array<{
      entry: WaitingListEntry;
      compatible: boolean;
      table?: { id: string; name: string; capacity: number };
    }>
  > {
    const entries = await this.prisma.waitingListEntry.findMany({
      where: {
        restaurantId: args.restaurantId,
        slotStart: args.slotStart,
        status: 'PENDING' as WaitingListStatus,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    const results: Array<{
      entry: WaitingListEntry;
      compatible: boolean;
      table?: { id: string; name: string; capacity: number };
    }> = [];

    for (const entry of entries) {
      const table = await this.tableAllocation.allocate(
        {
          restaurantId: entry.restaurantId,
          partySize: entry.partySize,
          startsAt: entry.slotStart,
          endsAt: entry.slotEnd,
          preferredSectionId: entry.preferredSectionId ?? undefined,
        },
        undefined,
        { readOnly: true },
      );

      if (table) {
        results.push({
          entry,
          compatible: true,
          table: { id: table.id, name: table.name, capacity: table.capacity },
        });
      } else {
        results.push({ entry, compatible: false });
      }
    }

    return results;
  }
}
