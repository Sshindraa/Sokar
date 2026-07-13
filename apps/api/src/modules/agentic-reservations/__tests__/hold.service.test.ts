/**
 * Tests unitaires du hold.service avec un faux PrismaClient.
 *
 * Le but est de tester la logique de gestion d'erreur (P2002 → HoldConflictError)
 * et la concurrence logique, sans avoir besoin d'une vraie DB.
 *
 * Les tests de concurrence réels (1000 req simultanées) sont dans
 * concurrency.test.ts, exécutés contre la vraie DB locale.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  HoldAlreadyConsumedError,
  HoldConflictError,
  HoldNotFoundError,
  HoldService,
} from '../core/hold.service.js';
import { AuditLogService } from '../core/audit-log.service.js';
import { buildPolicySnapshot } from '../core/policies.service.js';

type HoldRow = {
  id: string;
  restaurantId: string;
  type: 'QUOTE' | 'HOLD';
  partySize: number;
  slotStart: Date;
  slotEnd: Date;
  channel: string;
  quoteToken: string | null;
  holdToken: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'RELEASED';
  policyVersion: string;
  reservationId: string | null;
  createdAt: Date;
};

function makeFakes() {
  const holds = new Map<string, HoldRow>();
  const audits: Record<string, unknown>[] = [];

  // Simule la contrainte unique partielle : si on tente un create avec
  // un (restaurantId, slotStart, partySize, status=ACTIVE, type=HOLD) déjà
  // présent, on jette P2002.
  const prisma = {
    $transaction: async (fn: unknown) =>
      (fn as unknown as (tx: PrismaClient) => Promise<unknown>)(prisma as unknown as PrismaClient),
    agenticHold: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const type = data.type as 'HOLD' | 'QUOTE';
        const status = (data.status as HoldRow['status'] | undefined) ?? 'ACTIVE';
        if (type === 'HOLD' && status === 'ACTIVE') {
          for (const h of holds.values()) {
            const dSlotStart = data.slotStart;
            if (
              h.restaurantId === data.restaurantId &&
              h.partySize === data.partySize &&
              dSlotStart instanceof Date &&
              h.slotStart.getTime() === dSlotStart.getTime() &&
              h.status === 'ACTIVE'
            ) {
              const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: 'test',
              });
              throw err;
            }
          }
        }
        const id = `hold-${holds.size + 1}`;
        const row: HoldRow = {
          id,
          restaurantId: data.restaurantId as string,
          type,
          partySize: data.partySize as number,
          slotStart: data.slotStart as Date,
          slotEnd: data.slotEnd as Date,
          channel: data.channel as string,
          quoteToken: (data.quoteToken as string | null | undefined) ?? null,
          holdToken: (data.holdToken as string | null | undefined) ?? null,
          expiresAt: data.expiresAt as Date,
          consumedAt: (data.consumedAt as Date | null | undefined) ?? null,
          status,
          policyVersion: data.policyVersion as string,
          reservationId: (data.reservationId as string | null | undefined) ?? null,
          createdAt: new Date(),
        };
        holds.set(id, row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        for (const h of holds.values()) {
          let ok = true;
          const OR = where.OR as Record<string, unknown>[] | undefined;
          if (OR) {
            ok = OR.some((c) => {
              const cHoldToken = c.holdToken;
              const cQuoteToken = c.quoteToken;
              if (cHoldToken && h.holdToken === cHoldToken) return true;
              if (cQuoteToken && h.quoteToken === cQuoteToken) return true;
              return false;
            });
            if (!ok) continue;
          }
          if (where.status !== undefined && h.status !== where.status) continue;
          const expiresAt = where.expiresAt as Record<string, unknown> | undefined;
          const gt = expiresAt?.gt;
          if (gt instanceof Date && !(h.expiresAt.getTime() > gt.getTime())) continue;
          if (where.slotStart !== undefined) {
            const slotStart = where.slotStart;
            if (slotStart instanceof Date && h.slotStart.getTime() !== slotStart.getTime())
              continue;
          }
          if (where.partySize !== undefined && h.partySize !== where.partySize) continue;
          if (where.restaurantId !== undefined && h.restaurantId !== where.restaurantId) continue;
          if (where.type !== undefined && h.type !== where.type) continue;
          if (ok) return h;
        }
        return null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => holds.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const h = holds.get(where.id);
        if (!h) throw new Error('not found');
        return h;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const h = holds.get(where.id);
        if (!h) throw new Error('not found');
        Object.assign(h, data);
        return h;
      },
      findMany: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        const out: unknown[] = [];
        for (const h of holds.values()) {
          if (where.restaurantId !== undefined && h.restaurantId !== where.restaurantId) continue;
          if (where.partySize !== undefined && h.partySize !== where.partySize) continue;
          if (where.slotStart !== undefined) {
            const slotStart = where.slotStart;
            if (slotStart instanceof Date && h.slotStart.getTime() !== slotStart.getTime())
              continue;
          }
          if (where.type !== undefined && h.type !== where.type) continue;
          if (where.status !== undefined && h.status !== where.status) continue;
          const expiresAt = where.expiresAt as Record<string, unknown> | undefined;
          const lt = expiresAt?.lt;
          if (lt instanceof Date && !(h.expiresAt.getTime() < lt.getTime())) continue;
          out.push(
            select
              ? Object.fromEntries(
                  Object.keys(select).map((k) => [k, (h as Record<string, unknown>)[k]]),
                )
              : h,
          );
        }
        return out;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const h of holds.values()) {
          const idFilter = where.id as string | Record<string, unknown> | undefined;
          const inArr =
            typeof idFilter === 'object' && idFilter !== null
              ? ((idFilter as Record<string, unknown>).in as unknown[] | undefined)
              : undefined;
          if (inArr && !inArr.includes(h.id)) continue;
          if (typeof idFilter === 'string' && h.id !== idFilter) continue;
          if (where.status !== undefined && h.status !== where.status) continue;
          if (where.type !== undefined && h.type !== where.type) continue;
          const expiresAt = where.expiresAt as Record<string, unknown> | undefined;
          const lt = expiresAt?.lt;
          if (lt instanceof Date && !(h.expiresAt.getTime() < lt.getTime())) continue;
          const gt = expiresAt?.gt;
          if (gt instanceof Date && !(h.expiresAt.getTime() > gt.getTime())) continue;
          Object.assign(h, data);
          count++;
        }
        return { count };
      },
    },
    reservationAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;

  const audit = new AuditLogService(prisma);
  const service = new HoldService(prisma, audit);

  return { prisma, holds, audits, audit, service };
}

describe('hold.service', () => {
  let fakes: ReturnType<typeof makeFakes>;
  beforeEach(() => {
    fakes = makeFakes();
  });

  describe('createQuote', () => {
    it('crée un quote sans contrainte de capacité', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const q = await fakes.service.createQuote({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date('2026-06-22T19:00:00Z'),
        slotEnd: new Date('2026-06-22T21:00:00Z'),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
      });
      expect(q.type).toBe('QUOTE');
      expect(q.quoteToken).toBeTruthy();
      expect(q.holdToken).toBeNull();
    });

    it('insère un audit log quote_created', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      await fakes.service.createQuote({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date('2026-06-22T19:00:00Z'),
        slotEnd: new Date('2026-06-22T21:00:00Z'),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
      });
      expect(fakes.audits).toHaveLength(1);
      expect(fakes.audits[0].event).toBe('quote_created');
    });
  });

  describe('createHold', () => {
    it('crée un hold et émet un token', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const h = await fakes.service.createHold({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date('2026-06-22T19:00:00Z'),
        slotEnd: new Date('2026-06-22T21:00:00Z'),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
        tableId: 't-1',
      });
      expect(h.type).toBe('HOLD');
      expect(h.holdToken).toBeTruthy();
    });

    it('rejette 2 holds actifs sur le même slot avec HoldConflictError', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const args = {
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date('2026-06-22T19:00:00Z'),
        slotEnd: new Date('2026-06-22T21:00:00Z'),
        channel: 'MCP' as const,
        policy,
        actor: 'agent:test',
        tableId: 't-1' as const,
      };
      await fakes.service.createHold(args);
      await expect(fakes.service.createHold(args)).rejects.toThrow(HoldConflictError);
    });

    it('autorise 2 holds pour des partySize différents', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const base = {
        restaurantId: 'r-1',
        slotStart: new Date('2026-06-22T19:00:00Z'),
        slotEnd: new Date('2026-06-22T21:00:00Z'),
        channel: 'MCP' as const,
        policy,
        actor: 'agent:test',
        tableId: 't-1' as const,
      };
      const h1 = await fakes.service.createHold({ ...base, partySize: 2, tableId: 't-2' });
      const h2 = await fakes.service.createHold({ ...base, partySize: 4, tableId: 't-3' });
      expect(h1.id).not.toBe(h2.id);
    });

    it('autorise 2 quotes simultanés (ne bloquent pas la capacité)', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const args = {
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date('2026-06-22T19:00:00Z'),
        slotEnd: new Date('2026-06-22T21:00:00Z'),
        channel: 'MCP' as const,
        policy,
        actor: 'agent:test',
      };
      const q1 = await fakes.service.createQuote(args);
      const q2 = await fakes.service.createQuote(args);
      expect(q1.id).not.toBe(q2.id);
    });
  });

  describe('consumeHold', () => {
    it('passe un hold ACTIVE en CONSUMED', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const h = await fakes.service.createHold({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date(Date.now() + 60_000), // future
        slotEnd: new Date(Date.now() + 120_000),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
        tableId: 't-1',
      });
      const consumed = await fakes.service.consumeHold({
        holdId: h.id,
        reservationId: 'res-1',
        actor: 'agent:test',
      });
      expect(consumed.status).toBe('CONSUMED');
      expect(consumed.reservationId).toBe('res-1');
    });

    it('rejette un hold déjà consommé', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const h = await fakes.service.createHold({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date(Date.now() + 60_000),
        slotEnd: new Date(Date.now() + 120_000),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
        tableId: 't-1',
      });
      await fakes.service.consumeHold({
        holdId: h.id,
        reservationId: 'res-1',
        actor: 'agent:test',
      });
      await expect(
        fakes.service.consumeHold({ holdId: h.id, reservationId: 'res-2', actor: 'agent:test' }),
      ).rejects.toThrow(HoldAlreadyConsumedError);
    });

    it('rejette un hold expiré', async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const h = await fakes.service.createHold({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date(Date.now() - 120_000), // passé
        slotEnd: new Date(Date.now() - 60_000),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
        tableId: 't-1',
      });
      // Force l'expiration en backdating le expiresAt
      const row = fakes.holds.get(h.id)!;
      row.expiresAt = new Date(Date.now() - 1000);

      await expect(
        fakes.service.consumeHold({ holdId: h.id, reservationId: 'res-1', actor: 'agent:test' }),
      ).rejects.toThrow(HoldNotFoundError);
    });
  });

  describe('expireOverdue', () => {
    it("passe les holds expirés à EXPIRED et log l'événement", async () => {
      const policy = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms'],
        capacitySpecials: {},
      });
      const h = await fakes.service.createHold({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: new Date(Date.now() + 60_000),
        slotEnd: new Date(Date.now() + 120_000),
        channel: 'MCP',
        policy,
        actor: 'agent:test',
        tableId: 't-1',
      });
      fakes.holds.get(h.id)!.expiresAt = new Date(Date.now() - 1000);

      const count = await fakes.service.expireOverdue();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(fakes.holds.get(h.id)!.status).toBe('EXPIRED');
      const expireAudits = fakes.audits.filter((a) => a.event === 'hold_expired');
      expect(expireAudits.length).toBeGreaterThanOrEqual(1);
    });
  });
});
