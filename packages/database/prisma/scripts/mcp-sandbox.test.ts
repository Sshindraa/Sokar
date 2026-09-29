import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { markerFor, resetRun } from './mcp-sandbox';

function fakePrisma(options: {
  reservations: Array<{
    id: string;
    state: string;
    specialRequests: string;
  }>;
  auditedReservationIds: string[];
  externalReservationCount?: number;
}) {
  const calls = {
    auditCreates: [] as Array<{ data: Record<string, unknown> }>,
    reservationDeletes: [] as Array<{ where: { id: string } }>,
    reservationUpdates: [] as Array<{
      where: { id: string };
      data: Record<string, unknown>;
    }>,
    waitingListDeletes: [] as unknown[],
    holdDeletes: [] as unknown[],
    idempotencyDeletes: [] as unknown[],
    customerDeletes: [] as unknown[],
  };

  const tx = {
    reservation: {
      findMany: async () => options.reservations,
      delete: async (args: (typeof calls.reservationDeletes)[number]) => {
        calls.reservationDeletes.push(args);
      },
      update: async (args: (typeof calls.reservationUpdates)[number]) => {
        calls.reservationUpdates.push(args);
      },
      count: async () => options.externalReservationCount ?? 0,
    },
    reservationAuditLog: {
      findMany: async () =>
        options.auditedReservationIds.map((reservationId) => ({ reservationId })),
      create: async (args: (typeof calls.auditCreates)[number]) => {
        calls.auditCreates.push(args);
      },
    },
    waitingListEntry: {
      deleteMany: async (args: unknown) => calls.waitingListDeletes.push(args),
    },
    idempotencyRecord: {
      deleteMany: async (args: unknown) => calls.idempotencyDeletes.push(args),
    },
    agenticHold: {
      deleteMany: async (args: unknown) => calls.holdDeletes.push(args),
    },
    customer: {
      findMany: async () => [{ id: 'sandbox-customer' }],
      deleteMany: async (args: unknown) => calls.customerDeletes.push(args),
    },
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
  } as unknown as PrismaClient;

  return { prisma, calls };
}

test('reset keeps append-only audit history and anonymizes audited reservations', async () => {
  const runId = 'matrix-20260929';
  const marker = markerFor(runId);
  const { prisma, calls } = fakePrisma({
    reservations: [
      { id: 'confirmed', state: 'CONFIRMED', specialRequests: marker },
      { id: 'cancelled', state: 'CANCELLED', specialRequests: marker },
      { id: 'without-audit', state: 'CONFIRMED', specialRequests: marker },
    ],
    auditedReservationIds: ['confirmed', 'cancelled'],
  });

  await resetRun(
    prisma,
    'demo-restaurant',
    runId,
    new Date('2026-09-29T00:00:00.000Z'),
    '+33612345600',
  );

  assert.deepEqual(calls.reservationDeletes, [{ where: { id: 'without-audit' } }]);
  assert.deepEqual(
    calls.auditCreates.map(({ data }) => ({
      reservationId: data.reservationId,
      event: data.event,
    })),
    [
      { reservationId: 'confirmed', event: 'reservation_cancelled' },
      { reservationId: 'confirmed', event: 'reservation_anonymized' },
      { reservationId: 'cancelled', event: 'reservation_anonymized' },
    ],
  );
  assert.equal(calls.reservationUpdates.length, 2);
  assert.deepEqual(calls.reservationUpdates[0].data, {
    status: 'CANCELLED',
    state: 'CANCELLED',
    customerName: 'Réservation de test anonymisée',
    customerPhone: null,
    customerEmail: null,
    customerId: null,
    specialRequests: `${marker}:PURGED`,
    idempotencyScope: null,
    idempotencyKey: null,
    idempotencyPayloadHash: null,
  });
  assert.equal(calls.waitingListDeletes.length, 1);
  assert.equal(calls.holdDeletes.length, 1);
  assert.equal(calls.idempotencyDeletes.length, 1);
  assert.equal(calls.customerDeletes.length, 1);
});

test('reset does not append duplicate anonymization events to an already purged reservation', async () => {
  const runId = 'matrix-20260929';
  const { prisma, calls } = fakePrisma({
    reservations: [
      {
        id: 'already-purged',
        state: 'CANCELLED',
        specialRequests: `${markerFor(runId)}:PURGED`,
      },
    ],
    auditedReservationIds: ['already-purged'],
  });

  await resetRun(
    prisma,
    'demo-restaurant',
    runId,
    new Date('2026-09-29T00:00:00.000Z'),
    '+33612345600',
  );

  assert.deepEqual(calls.auditCreates, []);
  assert.deepEqual(calls.reservationDeletes, []);
  assert.equal(calls.reservationUpdates.length, 1);
});

test('reset preserves a sandbox customer still linked to an out-of-run reservation', async () => {
  const runId = 'matrix-20260929';
  const { prisma, calls } = fakePrisma({
    reservations: [],
    auditedReservationIds: [],
    externalReservationCount: 1,
  });

  await resetRun(
    prisma,
    'demo-restaurant',
    runId,
    new Date('2026-09-29T00:00:00.000Z'),
    '+33612345600',
  );

  assert.deepEqual(calls.customerDeletes, []);
});
