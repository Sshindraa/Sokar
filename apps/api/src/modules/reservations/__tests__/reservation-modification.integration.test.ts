import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
vi.unmock('@prisma/client');
import { db } from '../../../shared/db/client';
import { reservationManagementRoutes } from '../reservation-management.routes';
import { reservationManagementUrl } from '../reservation-management';
import { snapshotCancellationPolicy } from '../../../shared/reservations/cancellation-policy';
import { TableAllocationService } from '../../floor-plan/table-allocation.service';
import { zonedTimeToUtc } from '../../../shared/timezone/restaurant-time';
import { redisCache } from '../../../shared/redis/client';

const enabled =
  process.env.RESERVATION_MODIFICATION_INT_TESTS === '1' || process.env.AGENTIC_INT_TESTS === '1';
describe.skipIf(!enabled)('personal modification on PostgreSQL', () => {
  let restaurantId: string;
  let small: string;
  let large: string;
  const original = new Date('2099-06-05T17:00:00Z');
  const end = (start: Date) => new Date(start.getTime() + 90 * 60000);
  const terms = snapshotCancellationPolicy(
    { cancellationPolicy: "Annulation gratuite jusqu'à 24 heures avant le service." },
    'test',
  );
  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname))
      throw new Error('Local PostgreSQL required');
    vi.stubEnv('RESERVATION_MANAGEMENT_ENABLED', 'true');
    vi.stubEnv('RESERVATION_SELF_CANCELLATION_ENABLED', 'true');
    vi.stubEnv('RESERVATION_SELF_MODIFICATION_ENABLED', 'true');
    vi.stubEnv('RESERVATION_MANAGEMENT_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('DASHBOARD_URL', 'https://sokar.tech');
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Local modification test',
        slug: `local-modify-${crypto.randomUUID()}`,
        phoneNumber: `+331${Date.now().toString().slice(-8)}`,
        managerPhone: '+33600000000',
        managerEmail: 'test@example.invalid',
        timezone: 'Europe/Paris',
        openingHours: Object.fromEntries(
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
            (day) => [day, { open: '18:00', close: '23:00' }],
          ),
        ),
        exposureSettings: {
          create: {
            maxPartySize: 6,
            minLeadTimeMinutes: 30,
            capacitySpecials: { serviceDurationMinutes: 90, cancellationPolicy: terms.terms },
          },
        },
      },
    });
    restaurantId = restaurant.id;
    const floor = await db.floorPlan.create({
      data: { restaurantId, name: 'Local test', isActive: true, isDefault: true },
    });
    small = (
      await db.table.create({
        data: { floorPlanId: floor.id, name: 'Small', capacity: 2, isActive: true },
      })
    ).id;
    large = (
      await db.table.create({
        data: { floorPlanId: floor.id, name: 'Large', capacity: 4, isActive: true },
      })
    ).id;
  });
  afterEach(async () => {
    // Isolated local fixture only; keep append-only audits, free the owned tables.
    await db.reservation.updateMany({
      where: { restaurantId },
      data: { state: 'CANCELLED', status: 'CANCELLED' },
    });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  async function fixture(start = original) {
    const row = await db.reservation.create({
      data: {
        restaurantId,
        tableId: small,
        startsAt: start,
        reservedAt: start,
        endsAt: end(start),
        partySize: 2,
        customerName: 'Local test',
        customerPhone: '+33600000000',
        state: 'CONFIRMED',
        status: 'CONFIRMED',
        cancellationPolicySnap: terms,
      },
    });
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    const token = new URL(reservationManagementUrl(row)!).hash.slice(1);
    const post = (body: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/public/reservation-management',
        payload: { token, ...body },
      });
    return { row, app, post };
  }
  it('keeps the original until explicit confirmation, moves atomically and replays only once', async () => {
    const { row, app, post } = await fixture();
    try {
      const choices = await post({ action: 'modification_options', partySize: 3 });
      expect(choices.statusCode).toBe(200);
      const selected = choices.json().slots.find((slot: { time: string }) => slot.time === '20:00');
      expect(selected).toBeTruthy();
      expect(await db.reservation.findUnique({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        partySize: 2,
        tableId: small,
      });
      expect(
        (await post({ action: 'modify', proposalToken: selected.proposalToken })).statusCode,
      ).toBe(400);
      const results = await Promise.all([
        post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }),
        post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }),
      ]);
      expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
      expect(results[0].json()).toMatchObject({ time: '20:00', partySize: 3, state: 'CONFIRMED' });
      const changed = await db.reservation.findUniqueOrThrow({ where: { id: row.id } });
      expect(changed.tableId).toBe(large);
      expect(changed.cancellationPolicySnap).toEqual(terms);
      expect(
        await new TableAllocationService(db).isTableAvailable({
          tableId: small,
          startsAt: original,
          endsAt: end(original),
        }),
      ).toBe(true);
      expect(
        await db.reservationAuditLog.count({
          where: { reservationId: row.id, event: 'reservation_fields_changed' },
        }),
      ).toBe(1);
      expect((await post({ action: 'view' })).json()).toMatchObject({
        time: '20:00',
        partySize: 3,
      });
    } finally {
      await app.close();
    }
  });
  it('moves to another day atomically, preserves the original link and rejects invalid dates', async () => {
    const { row, app, post } = await fixture();
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    try {
      for (const date of ['2026-02-30', '2000-01-01', '2099-12-31']) {
        expect(
          (await post({ action: 'modification_options', partySize: 3, date })).statusCode,
        ).toBe(409);
      }
      const choices = await post({ action: 'modification_options', partySize: 3, date: day });
      expect(choices.statusCode).toBe(200);
      expect(choices.json().date).toBe(day);
      const selected = choices.json().slots.find((slot: { time: string }) => slot.time === '20:00');
      expect(selected).toBeTruthy();
      expect((await db.reservation.findUniqueOrThrow({ where: { id: row.id } })).startsAt).toEqual(
        original,
      );
      expect(
        (await post({ action: 'modify', proposalToken: selected.proposalToken })).statusCode,
      ).toBe(400);
      const targetStart = zonedTimeToUtc(day, '20:00', 'Europe/Paris');
      const blocker = await db.reservation.create({
        data: {
          restaurantId,
          tableId: large,
          startsAt: targetStart,
          reservedAt: targetStart,
          endsAt: end(targetStart),
          partySize: 4,
          customerName: 'Local test blocker',
          state: 'CONFIRMED',
          status: 'CONFIRMED',
        },
      });
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }))
          .statusCode,
      ).toBe(409);
      expect(await db.reservation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        tableId: small,
        partySize: 2,
      });
      await db.reservation.update({
        where: { id: blocker.id },
        data: { state: 'CANCELLED', status: 'CANCELLED' },
      });
      const updated = await post({
        action: 'modify',
        confirmed: true,
        proposalToken: selected.proposalToken,
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ date: day, time: '20:00', partySize: 3 });
      expect((await post({ action: 'view' })).json()).toMatchObject({
        date: day,
        time: '20:00',
        partySize: 3,
      });
      expect(
        await new TableAllocationService(db).isTableAvailable({
          tableId: small,
          startsAt: original,
          endsAt: end(original),
        }),
      ).toBe(true);
      expect(
        await db.reservationAuditLog.count({
          where: { reservationId: row.id, event: 'reservation_fields_changed' },
        }),
      ).toBe(1);
    } finally {
      await app.close();
    }
  });
  it('allows a two-month rescheduling and preserves access through the initial SMS link', async () => {
    const now = Date.now();
    const { row, app, post } = await fixture(new Date(now + 4 * 86400000));
    const date = new Date(now + 60 * 86400000).toISOString().slice(0, 10);
    try {
      const choices = await post({ action: 'modification_options', partySize: 3, date });
      expect(choices.statusCode).toBe(200);
      const selected = choices.json().slots.find((slot: { time: string }) => slot.time === '20:00');
      expect(selected).toBeTruthy();
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }))
          .statusCode,
      ).toBe(200);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now + 30 * 86400000);
      const laterView = await post({ action: 'view' });
      expect(laterView.statusCode).toBe(200);
      expect(laterView.json()).toMatchObject({ date, time: '20:00', partySize: 3 });
      vi.setSystemTime(now + 91 * 86400000);
      expect((await post({ action: 'view' })).statusCode).toBe(404);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });
  it('excludes only its own reservation without reading or publishing public cache entries', async () => {
    const { row, app, post } = await fixture();
    await db.reservation.create({
      data: {
        restaurantId,
        tableId: large,
        startsAt: original,
        reservedAt: original,
        endsAt: end(original),
        partySize: 4,
        customerName: 'Other table occupied',
        state: 'CONFIRMED',
        status: 'CONFIRMED',
      },
    });
    const read = vi.spyOn(redisCache, 'get');
    const write = vi.spyOn(redisCache, 'set');
    read.mockClear();
    write.mockClear();
    try {
      const choices = await post({ action: 'modification_options', partySize: 1 });
      expect(choices.json().slots.some((slot: { time: string }) => slot.time === '19:00')).toBe(
        true,
      );
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(await db.reservation.findUnique({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        tableId: small,
        partySize: 2,
      });
      expect(await db.reservationAuditLog.count({ where: { reservationId: row.id } })).toBe(0);
    } finally {
      read.mockRestore();
      write.mockRestore();
      await app.close();
    }
  });
  it('rolls back if the only suitable table is taken after the offer', async () => {
    const { row, app, post } = await fixture();
    try {
      const choices = await post({ action: 'modification_options', partySize: 3 });
      const selected = choices.json().slots.find((slot: { time: string }) => slot.time === '20:00');
      await db.reservation.create({
        data: {
          restaurantId,
          tableId: large,
          startsAt: new Date('2099-06-05T18:00:00Z'),
          reservedAt: new Date('2099-06-05T18:00:00Z'),
          endsAt: new Date('2099-06-05T19:30:00Z'),
          partySize: 4,
          customerName: 'Blocker',
          state: 'CONFIRMED',
          status: 'CONFIRMED',
        },
      });
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }))
          .statusCode,
      ).toBe(409);
      expect(await db.reservation.findUnique({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        partySize: 2,
        tableId: small,
        state: 'CONFIRMED',
      });
      expect(await db.reservationAuditLog.count({ where: { reservationId: row.id } })).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('rejects stale, altered and foreign proposals without changing the booking', async () => {
    const { row, app, post } = await fixture();
    try {
      const choices = await post({ action: 'modification_options', partySize: 3 });
      const selected = choices.json().slots[0];
      expect(
        (
          await post({
            action: 'modify',
            confirmed: true,
            proposalToken: selected.proposalToken.slice(0, -5) + 'AAAAA',
          })
        ).statusCode,
      ).toBe(409);
      const other = await db.reservation.create({
        data: {
          restaurantId,
          tableId: large,
          startsAt: original,
          reservedAt: original,
          endsAt: end(original),
          partySize: 2,
          customerName: 'Other local fixture',
          customerPhone: '+33600000001',
          state: 'CONFIRMED',
          status: 'CONFIRMED',
          cancellationPolicySnap: terms,
        },
      });
      const otherToken = new URL(reservationManagementUrl(other)!).hash.slice(1);
      expect(
        (
          await post({
            token: otherToken,
            action: 'modify',
            confirmed: true,
            proposalToken: selected.proposalToken,
          })
        ).statusCode,
      ).toBe(409);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60000);
      try {
        expect(
          (await post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }))
            .statusCode,
        ).toBe(409);
      } finally {
        clock.mockRestore();
      }
      await db.reservation.update({
        where: { id: row.id },
        data: { giftCardRedemptionSnap: { test: true } },
      });
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }))
          .statusCode,
      ).toBe(409);
      expect(await db.reservation.findUnique({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        partySize: 2,
      });
    } finally {
      await app.close();
    }
  });
  it('does not offer closed hours, oversized parties, or changes after the free deadline', async () => {
    const { row, app, post } = await fixture();
    try {
      const choices = await post({ action: 'modification_options', partySize: 3 });
      expect(choices.json().slots.some((slot: { time: string }) => slot.time === '12:00')).toBe(
        false,
      );
      expect((await post({ action: 'modification_options', partySize: 6 })).json().slots).toEqual(
        [],
      );
      await db.reservation.update({
        where: { id: row.id },
        data: {
          startsAt: new Date(Date.now() + 3600000),
          reservedAt: new Date(Date.now() + 3600000),
        },
      });
      expect((await post({ action: 'modification_options', partySize: 3 })).statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('rejects an old confirmation after a later modification returns to the initial details', async () => {
    const { row, app, post } = await fixture();
    try {
      const first = (await post({ action: 'modification_options', partySize: 3 }))
        .json()
        .slots.find((slot: { time: string }) => slot.time === '20:00');
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: first.proposalToken }))
          .statusCode,
      ).toBe(200);
      const back = (await post({ action: 'modification_options', partySize: 2 }))
        .json()
        .slots.find((slot: { time: string }) => slot.time === '19:00');
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: back.proposalToken }))
          .statusCode,
      ).toBe(200);
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: first.proposalToken }))
          .statusCode,
      ).toBe(409);
      expect(await db.reservation.findUnique({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        partySize: 2,
        tableId: small,
      });
      expect(
        await db.reservationAuditLog.count({
          where: { reservationId: row.id, event: 'reservation_fields_changed' },
        }),
      ).toBe(2);
    } finally {
      await app.close();
    }
  });
  it('does not let a larger party bypass a newly applicable deposit policy', async () => {
    const { row, app, post } = await fixture();
    try {
      const choices = await post({ action: 'modification_options', partySize: 3 });
      const selected = choices.json().slots[0];
      expect(selected).toBeTruthy();
      await db.reservationPaymentPolicy.create({
        data: {
          restaurantId,
          version: 1,
          type: 'DEPOSIT',
          amountMode: 'PER_PERSON',
          amount: 10,
          minPartySize: 3,
          activeFrom: new Date(0),
        },
      });
      expect(
        (await post({ action: 'modify', confirmed: true, proposalToken: selected.proposalToken }))
          .statusCode,
      ).toBe(409);
      expect(await db.reservation.findUnique({ where: { id: row.id } })).toMatchObject({
        startsAt: original,
        partySize: 2,
        tableId: small,
      });
      expect(await db.reservationPayment.count({ where: { reservationId: row.id } })).toBe(0);
      expect(await db.reservationAuditLog.count({ where: { reservationId: row.id } })).toBe(0);
    } finally {
      await app.close();
    }
  });
});
