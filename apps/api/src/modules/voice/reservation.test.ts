import { describe, it, expect, afterAll } from 'vitest';
import { getApp, closeApp } from '../../test/helpers';

const SAMPLE_RESTAURANT = {
  id: 'rest-1',
  name: 'Chez Test',
  phoneNumber: 'pn-test',
  managerPhone: '+33600000000',
  managerEmail: 'manager@test.fr',
  openingHours: {
    mon: { open: '12:00', close: '14:30' },
    tue: { open: '12:00', close: '14:30' },
    wed: { open: '12:00', close: '14:30' },
    thu: { open: '12:00', close: '14:30' },
    fri: { open: '12:00', close: '14:30' },
    sat: { open: '19:00', close: '23:00' },
    sun: null,
  },
  personality: null,
};

describe('Voice Pipeline — Function Calls', () => {
  it('POST /voice/function-call avec createReservation devrait retourner une confirmation', async () => {
    // Réinitialiser et configurer les mocks avant chaque requête
    // Les mocks sont réinitialisés à chaque test via l'import direct de db
    const { db } = await import('../../shared/db/client');
    const { redisCache } = await import('../../shared/redis/client');

    // On mocke getCachedContext pour retourner null (forcer DB lookup)
    (redisCache.get as any).mockResolvedValue(null);
    (db.restaurant.findUniqueOrThrow as any).mockResolvedValue(SAMPLE_RESTAURANT);
    (db.reservation.create as any).mockResolvedValue({
      id: 'res-1',
      restaurantId: 'rest-1',
      callId: 'call-123',
      reservedAt: new Date('2026-05-09T20:00:00'),
      partySize: 2,
      customerName: 'Dupont',
      customerPhone: '+33612345678',
      status: 'CONFIRMED',
      estimatedRevenue: 70,
    });

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/voice/function-call',
      headers: { 'x-vapi-secret': 'test-secret', 'content-type': 'application/json' },
      payload: {
        functionCall: {
          name: 'createReservation',
          parameters: {
            date: '2026-05-09',
            time: '20:00',
            partySize: 2,
            customerName: 'Dupont',
            customerPhone: '+33612345678',
          },
        },
        call: { id: 'call-123', phoneNumberId: 'pn-test' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toContain('Réservation confirmée');
    expect(body.result).toContain('Dupont');
    expect(body.result).toContain('2026-05-09');
    expect(body.result).toContain('20:00');
  });

  it('POST /voice/function-call sans x-vapi-secret devrait retourner 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/voice/function-call',
      headers: { 'content-type': 'application/json' },
      payload: {
        functionCall: { name: 'createReservation', parameters: {} },
        call: { id: 'call-123', phoneNumberId: 'pn-test' },
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('POST /voice/function-call avec une fonction inconnue devrait retourner 400', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/voice/function-call',
      headers: { 'x-vapi-secret': 'test-secret', 'content-type': 'application/json' },
      payload: {
        functionCall: { name: 'unknownFunction', parameters: {} },
        call: { id: 'call-123', phoneNumberId: 'pn-test' },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Unknown function');
  });
});

afterAll(async () => {
  await closeApp();
});
