/**
 * Tests de concurrence et de fallback Redis down.
 *
 * Tourne contre la vraie DB locale Postgres (DATABASE_URL dans
 * packages/database/.env). Ces tests sont marqués `integration` et
 * exclus par défaut ; ils sont exécutés par le script `pnpm test:int`.
 *
 * Pré-requis : avoir appliqué les migrations Phase 0 et créé un
 * restaurant de test.
 *
 * Le mock Prisma global (src/test/setup.ts) est bypass via vi.unmock
 * pour avoir accès aux vraies tables idempotency_records, agentic_holds,
 * reservation_audit_log, etc.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.unmock('@prisma/client');

import { PrismaClient } from '@prisma/client';
import { HoldConflictError, HoldService } from '../core/hold.service.js';
import { AuditLogService } from '../core/audit-log.service.js';
import { buildPolicySnapshot } from '../core/policies.service.js';
import { PrismaIdempotencyStore } from '../core/prisma-store.js';
import {
  IdempotencyService,
  computeIdempotencyScope,
  hashPayload,
} from '../core/idempotency.service.js';

const prisma = new PrismaClient();
const audit = new AuditLogService(prisma);
const holds = new HoldService(prisma, audit);
const idemStore = new PrismaIdempotencyStore(prisma);
const idem = new IdempotencyService(idemStore);
const runIntegration = process.env.AGENTIC_INT_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

let testRestaurantId: string;

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

beforeAll(async () => {
  if (!runIntegration) return;
  // Crée un restaurant de test (idempotent : on nettoie d'abord)
  // reservation_audit_log est append-only : on swallow le DELETE refusé.
  await prisma.reservationAuditLog
    .deleteMany({
      where: { metadata: { path: ['restaurantId'], equals: 'resto-test-concurrency' } },
    })
    .catch(() => undefined);
  await prisma.agenticHold.deleteMany({ where: { restaurantId: 'resto-test-concurrency' } });
  await prisma.restaurant.deleteMany({ where: { id: 'resto-test-concurrency' } });

  const r = await prisma.restaurant.create({
    data: {
      id: 'resto-test-concurrency',
      name: 'Resto Test Concurrency',
      slug: 'resto-test-concurrency',
      managerPhone: '+33600000000',
      managerEmail: 'test@example.com',
      phoneNumber: '+33100000001',
      openingHours: {},
      agenticOptIn: true,
    },
  });
  testRestaurantId = r.id;
});

afterAll(async () => {
  if (!runIntegration) return;
  await prisma.agenticHold.deleteMany({ where: { restaurantId: testRestaurantId } });
  // reservation_audit_log est append-only : le DELETE est refusé par le trigger.
  // C'est attendu, on swallow l'erreur de cleanup (les logs de test sont OK
  // à laisser en DB locale).
  await prisma.reservationAuditLog
    .deleteMany({
      where: { metadata: { path: ['restaurantId'], equals: testRestaurantId } },
    })
    .catch(() => undefined);
  await prisma.idempotencyRecord.deleteMany({
    where: { scope: { contains: testRestaurantId } },
  });
  await prisma.reservation.deleteMany({ where: { restaurantId: testRestaurantId } });
  await prisma.restaurant.deleteMany({ where: { id: testRestaurantId } });
  await prisma.$disconnect();
});

describeIntegration('concurrency — partial unique index enforcement', () => {
  it('1000 req simultanées sur le même slot → 1 seul hold, 999 conflits', async () => {
    const slotStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 90 * 60 * 1000);

    // Cleanup avant test
    await prisma.agenticHold.deleteMany({
      where: {
        restaurantId: testRestaurantId,
        slotStart,
        type: 'HOLD',
      },
    });

    const promises = Array.from({ length: 1000 }, () =>
      holds
        .createHold({
          restaurantId: testRestaurantId,
          partySize: 4,
          slotStart,
          slotEnd,
          channel: 'MCP',
          policy,
          actor: 'agent:concurrency-test',
        })
        .then(() => 'ok' as const)
        .catch((err) => {
          if (err instanceof HoldConflictError) return 'conflict' as const;
          throw err;
        }),
    );

    const results = await Promise.all(promises);
    const oks = results.filter((r) => r === 'ok').length;
    const conflicts = results.filter((r) => r === 'conflict').length;

    expect(oks).toBe(1);
    expect(conflicts).toBe(999);
    expect(oks + conflicts).toBe(1000);

    // Vérifie qu'il n'y a bien qu'un seul hold ACTIVE en DB
    const activeCount = await prisma.agenticHold.count({
      where: {
        restaurantId: testRestaurantId,
        slotStart,
        type: 'HOLD',
        status: 'ACTIVE',
      },
    });
    expect(activeCount).toBe(1);
  }, 30_000);

  it('après expiration du premier hold, un nouveau hold peut être créé', async () => {
    const slotStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 90 * 60 * 1000);

    await prisma.agenticHold.deleteMany({
      where: { restaurantId: testRestaurantId, slotStart, type: 'HOLD' },
    });

    const h1 = await holds.createHold({
      restaurantId: testRestaurantId,
      partySize: 2,
      slotStart,
      slotEnd,
      channel: 'MCP',
      policy,
      actor: 'agent:test1',
    });
    expect(h1.status).toBe('ACTIVE');

    // Force expiration
    await prisma.agenticHold.update({
      where: { id: h1.id },
      data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) },
    });

    // Nouveau hold doit passer
    const h2 = await holds.createHold({
      restaurantId: testRestaurantId,
      partySize: 2,
      slotStart,
      slotEnd,
      channel: 'MCP',
      policy,
      actor: 'agent:test2',
    });
    expect(h2.status).toBe('ACTIVE');
    expect(h2.id).not.toBe(h1.id);
  });
});

describeIntegration('idempotency — partial unique index on (scope, key)', () => {
  it('mêmes scope+key : 1 seule résa créée, N renvoient le même résultat', async () => {
    const scope = computeIdempotencyScope({
      restaurantId: testRestaurantId,
      channel: 'MCP',
      clientId: 'concurrency-test',
    });
    const key = 'idem-test-key-1';
    const payload = { partySize: 4, startsAt: '2026-12-01T19:00:00Z' };
    const payloadHash = hashPayload(payload);

    // Cleanup
    await prisma.idempotencyRecord.deleteMany({ where: { scope, key } });
    await prisma.reservation.deleteMany({
      where: { restaurantId: testRestaurantId, idempotencyScope: scope, idempotencyKey: key },
    });

    const attempts = Array.from({ length: 50 }, async () => {
      const result = await idem.reserve({ scope, key, payloadHash, ttlSeconds: 60 });
      return result;
    });

    const results = await Promise.all(attempts);
    const reserved = results.filter((r) => r === 'reserved').length;
    const reused = results.filter((r) => r === 'reused').length;
    expect(reserved).toBe(1);
    expect(reused).toBe(49);
    expect(reserved + reused).toBe(50);
  });

  it('mêmes scope+key mais payload différent → IdempotencyConflictError', async () => {
    const scope = computeIdempotencyScope({
      restaurantId: testRestaurantId,
      channel: 'MCP',
      clientId: 'conflict-test',
    });
    const key = 'idem-conflict-key';
    const payload1 = { partySize: 2, startsAt: '2026-12-02T19:00:00Z' };
    const payload2 = { partySize: 4, startsAt: '2026-12-02T19:00:00Z' };
    const hash1 = hashPayload(payload1);
    const hash2 = hashPayload(payload2);

    await prisma.idempotencyRecord.deleteMany({ where: { scope, key } });

    // Premier insert
    await idem.reserve({ scope, key, payloadHash: hash1, ttlSeconds: 60 });
    await idem.complete({ scope, key, payloadHash: hash1, reservationId: 'fake-res' });

    // Deuxième insert avec payload différent
    await expect(idem.reserve({ scope, key, payloadHash: hash2, ttlSeconds: 60 })).rejects.toThrow(
      /conflict/i,
    );
  });
});

describeIntegration('audit log — append-only enforcement', () => {
  it('UPDATE sur reservation_audit_log est rejeté par le trigger', async () => {
    // Crée un log
    const log = await prisma.reservationAuditLog.create({
      data: {
        event: 'hold_created',
        actor: 'test',
        metadata: {},
      },
    });

    // Tente un UPDATE
    await expect(
      prisma.reservationAuditLog.update({
        where: { id: log.id },
        data: { actor: 'tampered' },
      }),
    ).rejects.toThrow();

    // Cleanup
    await prisma.reservationAuditLog
      .deleteMany({
        where: { id: log.id },
      })
      .catch(() => {
        // Le trigger refuse DELETE — c'est attendu, on le démontre ici
      });
  });

  it('DELETE sur reservation_audit_log est rejeté par le trigger', async () => {
    const log = await prisma.reservationAuditLog.create({
      data: {
        event: 'hold_created',
        actor: 'test',
        metadata: {},
      },
    });

    await expect(prisma.reservationAuditLog.delete({ where: { id: log.id } })).rejects.toThrow();
  });
});
