import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.unmock('@prisma/client');
import { db } from '../../../shared/db/client';
import { purgeTestReservations } from '../test-reservation-purge';

const enabled = process.env.AGENTIC_INT_TESTS === '1';
describe.skipIf(!enabled)('test reservation purge on PostgreSQL', () => {
  beforeAll(() => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname))
      throw new Error('Local PostgreSQL required');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('purges expired tests with audit/outbox while normal and recent audit remain immutable', async () => {
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Local purge fixture',
        slug: `local-purge-${randomUUID()}`,
        phoneNumber: `+331${Date.now().toString().slice(-8)}`,
        managerPhone: '+33600000000',
        managerEmail: 'test@example.invalid',
        openingHours: {},
      },
    });
    const now = new Date();
    async function fixture(isTest: boolean, hoursOld: number) {
      const row = await db.reservation.create({
        data: {
          restaurantId: restaurant.id,
          isTest,
          partySize: 2,
          customerName: 'Local purge fixture',
          reservedAt: new Date(now.getTime() + 86400000),
          createdAt: new Date(now.getTime() - hoursOld * 3600000),
          state: 'CONFIRMED',
          status: 'CONFIRMED',
        },
      });
      const audit = await db.reservationAuditLog.create({
        data: {
          reservationId: row.id,
          actor: 'test',
          event: 'qualification.created',
        },
      });
      await db.outboxEvent.create({
        data: {
          restaurantId: restaurant.id,
          topic: 'qualification',
          aggregateType: 'reservation',
          aggregateId: row.id,
          eventType: 'qualification.created',
          idempotencyKey: randomUUID(),
          payload: { reservationId: row.id },
          status: 'DISPATCHED',
          dispatchedAt: now,
        },
      });
      return { row, audit };
    }
    const oldTest = await fixture(true, 25);
    const recentTest = await fixture(true, 1);
    const normal = await fixture(false, 25);
    for (const { audit } of [recentTest, normal]) {
      await expect(db.reservationAuditLog.delete({ where: { id: audit.id } })).rejects.toThrow(
        /append-only/,
      );
    }
    await expect(
      db.reservationAuditLog.update({
        where: { id: oldTest.audit.id },
        data: { event: 'changed' },
      }),
    ).rejects.toThrow(/append-only/);
    await purgeTestReservations(db, now);
    expect(await db.reservation.findUnique({ where: { id: oldTest.row.id } })).toBeNull();
    expect(await db.reservationAuditLog.count({ where: { reservationId: oldTest.row.id } })).toBe(
      0,
    );
    expect(await db.outboxEvent.count({ where: { aggregateId: oldTest.row.id } })).toBe(0);
    for (const { row, audit } of [recentTest, normal]) {
      expect(await db.reservation.findUnique({ where: { id: row.id } })).not.toBeNull();
      expect(await db.reservationAuditLog.findUnique({ where: { id: audit.id } })).not.toBeNull();
      expect(await db.outboxEvent.count({ where: { aggregateId: row.id } })).toBe(1);
    }
  });
});
