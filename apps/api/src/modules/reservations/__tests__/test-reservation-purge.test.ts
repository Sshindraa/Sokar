import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { purgeTestReservations } from '../test-reservation-purge';

function makeDb(batches: string[][]) {
  const remaining = [...batches];
  const calls: string[] = [];
  const tx = {
    reservationAuditLog: {
      deleteMany: vi.fn(async () => {
        calls.push('audit');
        return { count: 0 };
      }),
    },
    outboxEvent: {
      deleteMany: vi.fn(async () => {
        calls.push('outbox');
        return { count: 0 };
      }),
    },
    reservation: {
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        calls.push('reservation');
        return { count: args.where.id.in.length };
      }),
    },
  };
  const db = {
    reservation: {
      findMany: vi.fn(async () => (remaining.shift() ?? []).map((id) => ({ id }))),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db: db as unknown as PrismaClient, mocks: db, tx, calls };
}

describe('purgeTestReservations', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');

  it('sélectionne uniquement les réservations test de plus de 24 h', async () => {
    const { db, mocks } = makeDb([[]]);
    await purgeTestReservations(db, now);
    expect(mocks.reservation.findMany).toHaveBeenCalledWith({
      where: { isTest: true, createdAt: { lt: new Date('2026-10-17T12:00:00.000Z') } },
      select: { id: true },
      take: 200,
    });
  });

  it('ne fait rien quand la liste est vide', async () => {
    const { db, mocks } = makeDb([[]]);
    expect(await purgeTestReservations(db, now)).toBe(0);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('supprime audit, outbox puis réservations dans une transaction, isTest toujours vrai', async () => {
    const { db, tx, calls } = makeDb([['a', 'b'], []]);
    expect(await purgeTestReservations(db, now)).toBe(2);
    expect(calls).toEqual(['audit', 'outbox', 'reservation']);
    expect(tx.reservationAuditLog.deleteMany).toHaveBeenCalledWith({
      where: { reservationId: { in: ['a', 'b'] } },
    });
    expect(tx.outboxEvent.deleteMany).toHaveBeenCalledWith({
      where: { aggregateType: 'reservation', aggregateId: { in: ['a', 'b'] } },
    });
    expect(tx.reservation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, isTest: true },
    });
  });

  it('boucle par lots jusqu’à épuisement et additionne le total', async () => {
    const full = Array.from({ length: 200 }, (_, i) => `r${i}`);
    const { db, mocks } = makeDb([full, ['x'], []]);
    expect(await purgeTestReservations(db, now)).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });
});
