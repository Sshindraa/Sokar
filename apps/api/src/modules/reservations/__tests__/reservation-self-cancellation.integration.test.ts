import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.unmock('@prisma/client');
import { db } from '../../../shared/db/client';
import { reservationManagementRoutes } from '../reservation-management.routes';
import { reservationManagementUrl } from '../reservation-management';
import { snapshotCancellationPolicy } from '../../../shared/reservations/cancellation-policy';
import { TableAllocationService } from '../../floor-plan/table-allocation.service';

const enabled = process.env.RESERVATION_CANCELLATION_INT_TESTS === '1';
describe.skipIf(!enabled)('personal cancellation with PostgreSQL', () => {
  beforeAll(() => {
    // Fixtures must never target staging/production, even if an env file is wrong.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname))
      throw new Error('Local PostgreSQL required');
    vi.stubEnv('RESERVATION_MANAGEMENT_ENABLED', 'true');
    vi.stubEnv('RESERVATION_SELF_CANCELLATION_ENABLED', 'true');
    vi.stubEnv('RESERVATION_MANAGEMENT_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('DASHBOARD_URL', 'https://sokar.tech');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('serializes duplicate requests, releases the real table, preserves the audit and updates subsequent reads', async () => {
    const suffix = randomUUID();
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Local cancellation test',
        slug: `local-cancel-${suffix}`,
        managerPhone: '+33600000000',
        managerEmail: 'test@example.invalid',
        phoneNumber: `+331${Date.now().toString().slice(-8)}`,
        openingHours: {},
      },
    });
    const floor = await db.floorPlan.create({
      data: { restaurantId: restaurant.id, name: 'Local test', isActive: true, isDefault: true },
    });
    const table = await db.table.create({
      data: { floorPlanId: floor.id, name: 'Test', capacity: 2, isActive: true },
    });
    const startsAt = new Date(Date.now() + 7 * 86400000);
    const endsAt = new Date(startsAt.getTime() + 7200000);
    const reservation = await db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        tableId: table.id,
        startsAt,
        endsAt,
        reservedAt: startsAt,
        partySize: 2,
        customerName: 'Local test',
        customerPhone: '+33600000000',
        state: 'CONFIRMED',
        status: 'CONFIRMED',
        cancellationPolicySnap: snapshotCancellationPolicy(
          { cancellationPolicy: "Annulation gratuite jusqu'à 24 heures avant le service." },
          'test',
        ),
      },
    });
    const allocation = new TableAllocationService(db);
    const check = {
      restaurantId: restaurant.id,
      tableId: table.id,
      startsAt,
      endsAt,
      partySize: 2,
    };
    expect(await allocation.isTableAvailable(check)).toBe(false);
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    const token = new URL(reservationManagementUrl(reservation)!).hash.slice(1);
    const post = (body: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/public/reservation-management',
        payload: { token, ...body },
      });
    try {
      const view = await post({ action: 'view' });
      expect(view.statusCode).toBe(200);
      const confirmationToken = view.json().cancellation.confirmationToken;
      expect(confirmationToken).toBeTruthy();
      const results = await Promise.all([
        post({ action: 'cancel', confirmed: true, confirmationToken }),
        post({ action: 'cancel', confirmed: true, confirmationToken }),
      ]);
      expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
      expect(results.map((result) => result.json().state)).toEqual(['CANCELLED', 'CANCELLED']);
      expect(await db.reservation.findUnique({ where: { id: reservation.id } })).toMatchObject({
        state: 'CANCELLED',
        status: 'CANCELLED',
      });
      expect(await allocation.isTableAvailable(check)).toBe(true);
      expect(await db.reservationAuditLog.count({ where: { reservationId: reservation.id } })).toBe(
        1,
      );
      expect((await post({ action: 'view' })).json().state).toBe('CANCELLED');
    } finally {
      await app.close();
      // Append-only audit retains its isolated local fixture; never erase audit evidence.
    }
  });
});
