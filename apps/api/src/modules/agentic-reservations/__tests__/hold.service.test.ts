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
import { Prisma } from '@prisma/client';
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
  const audits: any[] = [];

  // Simule la contrainte unique partielle : si on tente un create avec
  // un (restaurantId, slotStart, partySize, status=ACTIVE, type=HOLD) déjà
  // présent, on jette P2002.
  const prisma: any = {
    $transaction: async (fn: any) => fn(prisma),
    agenticHold: {
      create: async ({ data }: any) => {
        if (data.type === 'HOLD' && data.status === 'ACTIVE') {
          for (const h of holds.values()) {
            if (
              h.restaurantId === data.restaurantId &&
              h.partySize === data.partySize &&
              h.slotStart.getTime() === data.slotStart.getTime() &&
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
          restaurantId: data.restaurantId,
          type: data.type,
          partySize: data.partySize,
          slotStart: data.slotStart,
          slotEnd: data.slotEnd,
          channel: data.channel,
          quoteToken: data.quoteToken ?? null,
          holdToken: data.holdToken ?? null,
          expiresAt: data.expiresAt,
          consumedAt: data.consumedAt ?? null,
          status: data.status ?? 'ACTIVE',
          policyVersion: data.policyVersion,
          reservationId: data.reservationId ?? null,
          createdAt: new Date(),
        };
        holds.set(id, row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        for (const h of holds.values()) {
          let ok = true;
          if (where.OR) {
            ok = where.OR.some((c: any) => {
              if (c.holdToken && h.holdToken === c.holdToken) return true;
              if (c.quoteToken && h.quoteToken === c.quoteToken) return true;
              return false;
            });
            if (!ok) continue;
          }
          if (where.status && h.status !== where.status) continue;
          if (where.expiresAt?.gt && !(h.expiresAt.getTime() > where.expiresAt.gt.getTime()))
            continue;
          if (where.slotStart && h.slotStart.getTime() !== where.slotStart.getTime()) continue;
          if (where.partySize && h.partySize !== where.partySize) continue;
          if (where.restaurantId && h.restaurantId !== where.restaurantId) continue;
          if (where.type && h.type !== where.type) continue;
          if (ok) return h;
        }
        return null;
      },
      findUnique: async ({ where }: any) => holds.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const h = holds.get(where.id);
        if (!h) throw new Error('not found');
        return h;
      },
      update: async ({ where, data }: any) => {
        const h = holds.get(where.id);
        if (!h) throw new Error('not found');
        Object.assign(h, data);
        return h;
      },
      findMany: async ({ where, select }: any) => {
        const out: any[] = [];
        for (const h of holds.values()) {
          if (where.restaurantId && h.restaurantId !== where.restaurantId) continue;
          if (where.partySize && h.partySize !== where.partySize) continue;
          if (where.slotStart && h.slotStart.getTime() !== where.slotStart.getTime()) continue;
          if (where.type && h.type !== where.type) continue;
          if (where.status && h.status !== where.status) continue;
          if (where.expiresAt?.lt && !(h.expiresAt.getTime() < where.expiresAt.lt.getTime()))
            continue;
          out.push(
            select ? Object.fromEntries(Object.keys(select).map((k) => [k, (h as any)[k]])) : h,
          );
        }
        return out;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const h of holds.values()) {
          if (where.id?.in && !where.id.in.includes(h.id)) continue;
          if (typeof where.id === 'string' && h.id !== where.id) continue;
          if (where.status && h.status !== where.status) continue;
          if (where.type && h.type !== where.type) continue;
          if (where.expiresAt?.lt && !(h.expiresAt.getTime() < where.expiresAt.lt.getTime()))
            continue;
          if (where.expiresAt?.gt && !(h.expiresAt.getTime() > where.expiresAt.gt.getTime()))
            continue;
          Object.assign(h, data);
          count++;
        }
        return { count };
      },
    },
    reservationAuditLog: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
  };

  const audit = new AuditLogService(prisma as any);
  const service = new HoldService(prisma as any, audit);

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
