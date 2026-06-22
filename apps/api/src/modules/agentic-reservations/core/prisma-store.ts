/**
 * Prisma implementation of IdempotencyStore.
 *
 * Postgres = source de vérité. La contrainte composite (scope, key) est
 * enforced par Postgres. Le service gère la translation P2002 → conflit
 * applicatif.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { IdempotencyStore } from './idempotency.service.js';

export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(scope: string, key: string) {
    const row = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!row) return null;
    return {
      payloadHash: row.payloadHash,
      reservationId: row.reservationId,
      status: row.status as 'pending' | 'completed' | 'failed',
      expiresAt: row.expiresAt,
    };
  }

  async insertPending(args: {
    scope: string;
    key: string;
    payloadHash: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          scope: args.scope,
          key: args.key,
          payloadHash: args.payloadHash,
          status: 'pending',
          expiresAt: args.expiresAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Violation de la contrainte unique composite (scope, key).
        // On laisse remonter ; IdempotencyService.lookup() détectera
        // l'existence et renverra un hit ou un conflict.
        throw err;
      }
      throw err;
    }
  }

  async markCompleted(args: {
    scope: string;
    key: string;
    reservationId: string;
    responseHash?: string;
  }): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { scope_key: { scope: args.scope, key: args.key } },
      data: {
        status: 'completed',
        reservationId: args.reservationId,
        responseHash: args.responseHash ?? null,
      },
    });
  }

  async markFailed(args: { scope: string; key: string }): Promise<void> {
    // Si le record n'existe pas, on l'insère en failed pour traçabilité.
    await this.prisma.idempotencyRecord.upsert({
      where: { scope_key: { scope: args.scope, key: args.key } },
      update: { status: 'failed' },
      create: {
        scope: args.scope,
        key: args.key,
        payloadHash: 'unknown',
        status: 'failed',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  async purgeExpired(): Promise<number> {
    const result = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
