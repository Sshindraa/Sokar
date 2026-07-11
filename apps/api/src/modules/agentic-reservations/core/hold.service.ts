/**
 * Hold service : crée et consomme les AgenticHold (quote + hold).
 *
 * Concurrence : la contrainte partielle SQL `one_active_hold_per_slot`
 * (définie dans la migration 20260621004000_agentic_p0_constraints) garantit
 * qu'il n'y a qu'un seul hold actif par (restaurant, slot, party_size).
 * On capte la P2002 (unique violation) et on la traduit en HoldConflictError.
 *
 * TTL : les expiresAt sont calculés par policies.service. Le worker
 * `expire-hold` (BullMQ) passera les holds à EXPIRED après expiration.
 * checkAvailability() ignore les holds EXPIRED même si le worker n'est pas
 * encore passé.
 */

import { Prisma } from '@prisma/client';
import type {
  AgenticHold,
  HoldStatus,
  HoldType,
  PrismaClient,
  ReservationChannel,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditLogService } from './audit-log.service.js';
import {
  type PolicySnapshot,
  computeHoldExpiresAt,
  computeQuoteExpiresAt,
} from './policies.service.js';
import type { ReservationChannel as Channel } from './state-machine.js';
import { TableAllocationService } from '../../floor-plan/table-allocation.service.js';

import { DEFAULT_TRANSACTION_OPTIONS } from '../../../shared/db/transaction-options';
import { scheduleHoldExpiration, scheduleQuoteExpiration } from '../workers/queues.js';

export class HoldConflictError extends Error {
  constructor(
    public readonly restaurantId: string,
    public readonly slotStart: Date,
    public readonly partySize: number,
  ) {
    super(
      `Hold conflict: restaurant=${restaurantId} slot=${slotStart.toISOString()} party=${partySize}`,
    );
    this.name = 'HoldConflictError';
  }
}

export class HoldNotFoundError extends Error {
  constructor(public readonly token: string) {
    super(`Hold not found or expired: token=${token}`);
    this.name = 'HoldNotFoundError';
  }
}

export class HoldAlreadyConsumedError extends Error {
  constructor(public readonly id: string) {
    super(`Hold already consumed: id=${id}`);
    this.name = 'HoldAlreadyConsumedError';
  }
}

export function generateHoldToken(): string {
  return randomBytes(24).toString('base64url');
}

export class HoldService {
  private readonly tableAllocation: TableAllocationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditLogService,
  ) {
    this.tableAllocation = new TableAllocationService(prisma);
  }

  /**
   * Crée un quote (estimation rapide, sans bloquer la capacité).
   * Un quote ne participe pas à la contrainte partielle (WHERE type='HOLD').
   */
  async createQuote(args: {
    restaurantId: string;
    partySize: number;
    slotStart: Date;
    slotEnd: Date;
    channel: Channel;
    policy: PolicySnapshot;
    actor: string;
  }): Promise<AgenticHold> {
    const expiresAt = computeQuoteExpiresAt(args.policy);

    const hold = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agenticHold.create({
        data: {
          restaurantId: args.restaurantId,
          type: 'QUOTE' as HoldType,
          partySize: args.partySize,
          slotStart: args.slotStart,
          slotEnd: args.slotEnd,
          channel: args.channel as ReservationChannel,
          quoteToken: generateHoldToken(),
          expiresAt,
          status: 'ACTIVE' as HoldStatus,
          policyVersion: args.policy.policyVersion,
        },
      });

      await this.audit.record(
        {
          event: 'quote_created',
          holdId: created.id,
          actor: args.actor,
          metadata: {
            restaurantId: args.restaurantId,
            partySize: args.partySize,
            slotStart: args.slotStart.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
        },
        tx,
      );

      return created;
    }, DEFAULT_TRANSACTION_OPTIONS);

    await scheduleQuoteExpiration({ quoteId: hold.id, expiresAt });

    return hold;
  }

  /**
   * Crée un hold (réservation de capacité, bloque la contrainte partielle).
   * Si un hold actif existe déjà pour ce slot, jette HoldConflictError.
   *
   * L'allocation de table et l'INSERT sont exécutés dans une transaction Prisma
   * avec SELECT FOR UPDATE, ce qui évite les allocations concurrentes sur la
   * même table.
   */
  async createHold(args: {
    restaurantId: string;
    partySize: number;
    slotStart: Date;
    slotEnd: Date;
    channel: Channel;
    policy: PolicySnapshot;
    actor: string;
    tableId?: string | null;
  }): Promise<AgenticHold> {
    const expiresAt = computeHoldExpiresAt(args.policy);
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const hold = await this.prisma.$transaction(async (tx) => {
          let tableId = args.tableId ?? null;

          if (!tableId) {
            const table = await this.tableAllocation.allocate(
              {
                restaurantId: args.restaurantId,
                partySize: args.partySize,
                startsAt: args.slotStart,
                endsAt: args.slotEnd,
              },
              tx,
            );
            if (!table) {
              throw new HoldConflictError(args.restaurantId, args.slotStart, args.partySize);
            }
            tableId = table.id;
          }

          const existingHold = await tx.agenticHold.findFirst({
            where: {
              restaurantId: args.restaurantId,
              partySize: args.partySize,
              slotStart: args.slotStart,
              type: 'HOLD' as HoldType,
              status: 'ACTIVE' as HoldStatus,
            },
          });
          if (existingHold) {
            throw new HoldConflictError(args.restaurantId, args.slotStart, args.partySize);
          }

          const created = await this.insertHold({ ...args, tableId }, expiresAt, tx);

          await this.audit.record(
            {
              event: 'hold_created',
              holdId: created.id,
              actor: args.actor,
              metadata: {
                restaurantId: args.restaurantId,
                partySize: args.partySize,
                slotStart: args.slotStart.toISOString(),
                expiresAt: expiresAt.toISOString(),
                tableId: tableId ?? null,
              },
            },
            tx,
          );

          return created;
        }, DEFAULT_TRANSACTION_OPTIONS);

        await scheduleHoldExpiration({ holdId: hold.id, expiresAt });

        return hold;
      } catch (err) {
        if (err instanceof HoldConflictError) {
          throw err;
        }

        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const expiredConflict = await this.prisma.agenticHold.findFirst({
            where: {
              restaurantId: args.restaurantId,
              partySize: args.partySize,
              slotStart: args.slotStart,
              type: 'HOLD' as HoldType,
              status: 'ACTIVE' as HoldStatus,
              expiresAt: { lt: new Date() },
            },
            select: { id: true },
          });
          if (!expiredConflict) {
            throw new HoldConflictError(args.restaurantId, args.slotStart, args.partySize);
          }

          await this.expireOverdueForSlot({
            restaurantId: args.restaurantId,
            partySize: args.partySize,
            slotStart: args.slotStart,
            now: new Date(),
          });

          continue;
        }

        throw err;
      }
    }

    throw new HoldConflictError(args.restaurantId, args.slotStart, args.partySize);
  }

  /**
   * Cherche un hold actif (non expiré) par token.
   * Renvoie null si introuvable, expiré, ou consommé.
   */
  async findActiveByToken(token: string): Promise<AgenticHold | null> {
    const hold = await this.prisma.agenticHold.findFirst({
      where: {
        OR: [{ holdToken: token }, { quoteToken: token }],
        status: 'ACTIVE' as HoldStatus,
        expiresAt: { gt: new Date() },
      },
    });
    return hold;
  }

  /**
   * Consomme un hold : passe son status à CONSUMED et lie la réservation.
   * À l'intérieur d'une transaction pour atomicité.
   */
  async consumeHold(args: {
    holdId: string;
    reservationId: string;
    actor: string;
  }): Promise<AgenticHold> {
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.agenticHold.findUnique({ where: { id: args.holdId } });
      if (!hold) throw new HoldNotFoundError(args.holdId);
      if (hold.status === 'CONSUMED') throw new HoldAlreadyConsumedError(hold.id);
      if (hold.type !== 'HOLD') throw new HoldNotFoundError(args.holdId);
      if (hold.status === 'EXPIRED' || hold.expiresAt.getTime() < Date.now()) {
        // Force l'expiration si le worker n'est pas encore passé
        await tx.agenticHold.updateMany({
          where: {
            id: hold.id,
            status: 'ACTIVE' as HoldStatus,
            expiresAt: { lt: new Date() },
          },
          data: { status: 'EXPIRED' as HoldStatus },
        });
        throw new HoldNotFoundError(args.holdId);
      }

      const consume = await tx.agenticHold.updateMany({
        where: {
          id: hold.id,
          type: 'HOLD' as HoldType,
          status: 'ACTIVE' as HoldStatus,
          expiresAt: { gt: new Date() },
        },
        data: {
          status: 'CONSUMED' as HoldStatus,
          consumedAt: new Date(),
          reservationId: args.reservationId,
        },
      });
      if (consume.count !== 1) {
        const latest = await tx.agenticHold.findUnique({ where: { id: hold.id } });
        if (latest?.status === 'CONSUMED') throw new HoldAlreadyConsumedError(hold.id);
        throw new HoldNotFoundError(args.holdId);
      }

      const updated = await tx.agenticHold.findUniqueOrThrow({ where: { id: hold.id } });

      await tx.reservationAuditLog.create({
        data: {
          event: 'hold_consumed',
          holdId: hold.id,
          reservationId: args.reservationId,
          actor: args.actor,
          metadata: {
            type: hold.type,
            slotStart: hold.slotStart.toISOString(),
            partySize: hold.partySize,
          },
        },
      });

      return updated;
    }, DEFAULT_TRANSACTION_OPTIONS);
  }

  /**
   * Libère un hold (annulation côté agent sans création de résa).
   */
  async releaseHold(args: { holdId: string; actor: string; reason?: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const hold = await tx.agenticHold.findUnique({ where: { id: args.holdId } });
      if (!hold || hold.status !== 'ACTIVE') return;

      await tx.agenticHold.update({
        where: { id: hold.id },
        data: { status: 'RELEASED' as HoldStatus },
      });

      await tx.reservationAuditLog.create({
        data: {
          event: 'hold_released',
          holdId: hold.id,
          actor: args.actor,
          metadata: { reason: args.reason ?? null },
        },
      });
    });
  }

  /**
   * Worker entry : passe tous les holds expirés à EXPIRED.
   * Renvoie le nombre de holds expirés.
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.$transaction(async (tx) => {
      const overdue = await tx.agenticHold.findMany({
        where: {
          status: 'ACTIVE' as HoldStatus,
          expiresAt: { lt: now },
        },
        select: { id: true, type: true, restaurantId: true },
      });

      if (overdue.length === 0) return 0;

      let expiredCount = 0;
      for (const h of overdue) {
        const updated = await tx.agenticHold.updateMany({
          where: {
            id: h.id,
            status: 'ACTIVE' as HoldStatus,
            expiresAt: { lt: now },
          },
          data: { status: 'EXPIRED' as HoldStatus },
        });
        if (updated.count !== 1) continue;

        await tx.reservationAuditLog.create({
          data: {
            event: h.type === 'QUOTE' ? 'quote_expired' : 'hold_expired',
            holdId: h.id,
            actor: 'system:expire-worker',
            metadata: { restaurantId: h.restaurantId },
          },
        });
        expiredCount++;
      }

      return expiredCount;
    });
    return result;
  }

  private async insertHold(
    args: {
      restaurantId: string;
      partySize: number;
      slotStart: Date;
      slotEnd: Date;
      channel: Channel;
      policy: PolicySnapshot;
      actor: string;
      tableId?: string | null;
    },
    expiresAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<AgenticHold> {
    const prisma = tx ?? this.prisma;
    return prisma.agenticHold.create({
      data: {
        restaurantId: args.restaurantId,
        type: 'HOLD' as HoldType,
        partySize: args.partySize,
        slotStart: args.slotStart,
        slotEnd: args.slotEnd,
        channel: args.channel as ReservationChannel,
        holdToken: generateHoldToken(),
        expiresAt,
        status: 'ACTIVE' as HoldStatus,
        policyVersion: args.policy.policyVersion,
        tableId: args.tableId ?? null,
      },
    });
  }

  /**
   * Worker entry ciblée : expire un hold/quote précis si son TTL est dépassé.
   * Idempotent : renvoie false si déjà consommé, libéré, expiré ou pas encore dû.
   */
  async expireOne(args: {
    holdId: string;
    expectedType?: HoldType;
    now?: Date;
    actor?: string;
  }): Promise<boolean> {
    const now = args.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.agenticHold.findUnique({ where: { id: args.holdId } });
      if (!hold) return false;
      if (args.expectedType && hold.type !== args.expectedType) return false;
      if (hold.status !== 'ACTIVE' || hold.expiresAt.getTime() >= now.getTime()) return false;

      const updated = await tx.agenticHold.updateMany({
        where: {
          id: hold.id,
          status: 'ACTIVE' as HoldStatus,
          expiresAt: { lt: now },
        },
        data: { status: 'EXPIRED' as HoldStatus },
      });
      if (updated.count !== 1) return false;

      await tx.reservationAuditLog.create({
        data: {
          event: hold.type === 'QUOTE' ? 'quote_expired' : 'hold_expired',
          holdId: hold.id,
          actor: args.actor ?? 'system:expire-worker',
          metadata: { restaurantId: hold.restaurantId },
        },
      });

      return true;
    });
  }

  private async expireOverdueForSlot(args: {
    restaurantId: string;
    partySize: number;
    slotStart: Date;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const overdue = await tx.agenticHold.findMany({
        where: {
          restaurantId: args.restaurantId,
          partySize: args.partySize,
          slotStart: args.slotStart,
          type: 'HOLD' as HoldType,
          status: 'ACTIVE' as HoldStatus,
          expiresAt: { lt: args.now },
        },
        select: { id: true, restaurantId: true },
      });

      for (const hold of overdue) {
        const updated = await tx.agenticHold.updateMany({
          where: {
            id: hold.id,
            status: 'ACTIVE' as HoldStatus,
            expiresAt: { lt: args.now },
          },
          data: { status: 'EXPIRED' as HoldStatus },
        });
        if (updated.count !== 1) continue;

        await tx.reservationAuditLog.create({
          data: {
            event: 'hold_expired',
            holdId: hold.id,
            actor: 'system:hold-service',
            metadata: { restaurantId: hold.restaurantId },
          },
        });
      }
    });
  }
}
