import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reservationManagementUrl,
  parseReservationManagementToken,
  verifyReservationManagementToken,
} from '../reservation-management';
import { reservationManagementRoutes } from '../reservation-management.routes';
import { db } from '../../../shared/db/client';
import { buildConfirmationText } from '../../../shared/messaging/confirmation-text';
import { countSmsSegments } from '../../usage/messaging-usage.service';

vi.mock('../../../shared/db/client', () => ({
  db: { reservation: { findUnique: vi.fn(), updateMany: vi.fn() } },
}));

describe('personal reservation management', () => {
  const row = {
    id: randomUUID(),
    restaurantId: randomUUID(),
    createdAt: new Date(),
    reservedAt: new Date(Date.now() + 2 * 86_400_000),
    startsAt: null,
    endsAt: null,
    customerPhone: '+33600000000',
    customerName: 'Private name',
    customerEmail: 'private@example.invalid',
    partySize: 2,
    channel: 'WEB',
    state: 'CONFIRMED',
    consents: {
      transactionalWhatsapp: true,
      whatsappConsentProof: { version: 'test' },
      unrelated: true,
    },
    restaurant: {
      name: 'Restaurant Exemple',
      formattedAddress: '12 rue de la Table, 75002 Paris',
      timezone: 'Europe/Paris',
      phoneNumber: '+33100000000',
    },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('RESERVATION_MANAGEMENT_ENABLED', 'true');
    vi.stubEnv('RESERVATION_MANAGEMENT_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('DASHBOARD_URL', 'https://sokar.tech');
    vi.mocked(db.reservation.findUnique).mockResolvedValue(row as never);
    vi.mocked(db.reservation.updateMany).mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  const token = () => new URL(reservationManagementUrl(row)!).hash.slice(1);

  it('returns a stable short fragment link with no plaintext identity', () => {
    const url = reservationManagementUrl(row)!;
    expect(url).toBe(reservationManagementUrl(row));
    expect(new URL(url).pathname).toBe('/r');
    expect(new URL(url).search).toBe('');
    expect(url).not.toContain(row.customerPhone);
    expect(url).not.toContain(row.restaurantId);
    expect(verifyReservationManagementToken(token(), row)).toBe(true);
  });
  it('expires and rejects wrong recipient, tenant, signature and signing key', () => {
    const bearer = token();
    expect(
      parseReservationManagementToken(bearer, new Date(Date.now() + 100 * 86_400_000)),
    ).toBeUndefined();
    expect(
      verifyReservationManagementToken(bearer, { ...row, customerPhone: '+33600000001' }),
    ).toBe(false);
    expect(verifyReservationManagementToken(bearer, { ...row, restaurantId: randomUUID() })).toBe(
      false,
    );
    expect(verifyReservationManagementToken(bearer.slice(0, -2) + 'AA', row)).toBe(false);
    vi.stubEnv('RESERVATION_MANAGEMENT_SECRET', randomBytes(32).toString('hex'));
    expect(verifyReservationManagementToken(bearer, row)).toBe(false);
  });
  it('keeps a signed link after rescheduling, but never beyond 90 days or for another recipient', () => {
    const bearer = token();
    const later = new Date(row.createdAt.getTime() + 30 * 86400000);
    const moved = { ...row, reservedAt: new Date(row.createdAt.getTime() + 60 * 86400000) };
    expect(parseReservationManagementToken(bearer, later)).toBeUndefined();
    expect(verifyReservationManagementToken(bearer, row, later)).toBe(false);
    expect(verifyReservationManagementToken(bearer, moved, later)).toBe(true);
    expect(
      verifyReservationManagementToken(bearer, { ...moved, customerPhone: '+33600000001' }, later),
    ).toBe(false);
    expect(
      verifyReservationManagementToken(
        bearer,
        moved,
        new Date(row.createdAt.getTime() + 91 * 86400000),
      ),
    ).toBe(false);
  });
  it('has no secret fallback and refuses a non-HTTPS public origin', () => {
    vi.stubEnv('DASHBOARD_URL', 'http://example.invalid');
    expect(reservationManagementUrl(row)).toBeUndefined();
    vi.stubEnv('RESERVATION_MANAGEMENT_SECRET', '');
    expect(reservationManagementUrl(row)).toBeUndefined();
  });
  it.each(['https://sokar.tech', 'https://staging.sokar.tech'])(
    'keeps the real link inside one SMS segment at %s',
    (origin) => {
      vi.stubEnv('DASHBOARD_URL', origin);
      const url = reservationManagementUrl(row)!;
      const text = buildConfirmationText('餐厅 '.repeat(30), '18/10/2026', '19:00', 20, url);
      expect(countSmsSegments(text)).toBe(1);
      expect(text).toContain(url);
    },
  );
  it('opens read-only without exposing customer data or granting cancellation', async () => {
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    try {
      const result = await app.inject({
        method: 'POST',
        url: '/public/reservation-management',
        payload: { token: token(), action: 'view' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.json()).toMatchObject({
        restaurantName: row.restaurant.name,
        restaurantAddress: row.restaurant.formattedAddress,
        startsAt: row.reservedAt.toISOString(),
        endsAt: null,
        whatsappReminder: { enabled: true },
      });
      expect(result.body).not.toContain(row.customerPhone);
      expect(result.body).not.toContain(row.customerName);
      expect(result.body).not.toContain(row.customerEmail);
      expect(db.reservation.updateMany).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/public/reservation-management',
            payload: { token: token(), action: 'cancel' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it.each([
    [true, true],
    [undefined, false],
  ])('reports isTest=%s as test=%s', async (isTest, expected) => {
    vi.mocked(db.reservation.findUnique).mockResolvedValue({ ...row, isTest } as never);
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    try {
      const result = await app.inject({
        method: 'POST',
        url: '/public/reservation-management',
        payload: { token: token(), action: 'view' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().test).toBe(expected);
    } finally {
      await app.close();
    }
  });
  it('withdraws using a tenant-scoped optimistic write and preserves other consent', async () => {
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    try {
      const result = await app.inject({
        method: 'POST',
        url: '/public/reservation-management',
        payload: { token: token(), action: 'withdraw_whatsapp' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().whatsappReminder.enabled).toBe(false);
      expect(db.reservation.updateMany).toHaveBeenCalledWith({
        where: { id: row.id, restaurantId: row.restaurantId, consents: { equals: row.consents } },
        data: {
          consents: expect.objectContaining({
            transactionalWhatsapp: false,
            unrelated: true,
            whatsappWithdrawnAt: expect.any(String),
          }),
        },
      });
    } finally {
      await app.close();
    }
  });
  it('does not claim withdrawal if a concurrent update won', async () => {
    vi.mocked(db.reservation.updateMany).mockResolvedValueOnce({ count: 0 });
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/public/reservation-management',
            payload: { token: token(), action: 'withdraw_whatsapp' },
          })
        ).statusCode,
      ).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('is disabled by default and hides a wrong token with a generic error', async () => {
    const bearer = token();
    const app = Fastify();
    await app.register(reservationManagementRoutes);
    try {
      vi.stubEnv('RESERVATION_MANAGEMENT_ENABLED', 'false');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/public/reservation-management',
            payload: { token: bearer, action: 'view' },
          })
        ).statusCode,
      ).toBe(404);
      vi.stubEnv('RESERVATION_MANAGEMENT_ENABLED', 'true');
      vi.mocked(db.reservation.findUnique).mockResolvedValueOnce({
        ...row,
        restaurantId: randomUUID(),
      } as never);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/public/reservation-management',
            payload: { token: bearer, action: 'view' },
          })
        ).statusCode,
      ).toBe(404);
      expect(db.reservation.updateMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
