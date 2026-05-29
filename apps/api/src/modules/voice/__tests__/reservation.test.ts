import { describe, it, expect, afterAll, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

// Mock telnyx guard — bypass signature verification in tests
vi.mock('../telnyx.guard', () => ({
  telnyxWebhookGuard: vi.fn(async (_req: any, _reply: any) => {
    // No-op: always pass in tests
  }),
}));

const SAMPLE_RESTAURANT = {
  id: 'rest-1',
  name: 'Chez Test',
  phoneNumber: 'pn-test',
  managerPhone: '+336****0000',
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
  it('POST /voice/telnyx/function-call avec createReservation devrait retourner une confirmation', async () => {
    const { db } = await import('../../../shared/db/client');
    const { redisCache } = await import('../../../shared/redis/client');

    (redisCache.get as any).mockResolvedValue(null);
    (db.restaurant.findUniqueOrThrow as any).mockResolvedValue(SAMPLE_RESTAURANT);
    (db.reservation.create as any).mockResolvedValue({
      id: 'res-1',
      restaurantId: 'rest-1',
      callId: 'call-123',
      reservedAt: new Date('2026-05-09T20:00:00'),
      partySize: 2,
      customerName: 'Dupont',
      customerPhone: '+336****5678',
      status: 'CONFIRMED',
      estimatedRevenue: 70,
    });

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx/function-call',
      headers: { 'content-type': 'application/json' },
      payload: {
        function_call: {
          name: 'createReservation',
          parameters: {
            date: '2026-05-09',
            time: '20:00',
            partySize: 2,
            customerName: 'Dupont',
            customerPhone: '+336****5678',
          },
        },
        call_control_id: 'call-123',
        to: 'pn-test',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toContain('Réservation confirmée');
    expect(body.result).toContain('Dupont');
    expect(body.result).toContain('2026-05-09');
    expect(body.result).toContain('20:00');
  });

  it('POST /voice/telnyx/function-call avec une fonction inconnue devrait retourner 400', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx/function-call',
      headers: { 'content-type': 'application/json' },
      payload: {
        function_call: { name: 'unknownFunction', parameters: {} },
        call_control_id: 'call-123',
        to: 'pn-test',
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
