import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';
import { placeOutboundCall } from '../../../shared/telnyx/client';

vi.mock('../../../shared/telnyx/client', () => ({
  placeOutboundCall: vi.fn(),
}));

const baseRestaurant = {
  id: 'test-rest-1',
  name: 'Le Bistrot',
  managerPhone: '+33612345678',
  managerEmail: 'gerant@sokar.tech',
  phoneNumber: '+33123456789',
  openingHours: { tue: { open: '12:00', close: '22:00' } },
  googleRefreshToken: 'google-refresh-token',
  googleCalendarId: 'primary',
  onboardingTasks: null,
  onboardingDone: false,
  onboardingCompletedAt: null,
  onboardingActivatedAt: null,
  onboardingLastSeenAt: null,
  firstCallAt: null,
  personality: { id: 'personality-1' },
};

describe('restaurant.routes - onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('bloque la complétion téléphone tant qu’aucun numéro Sokar n’est attribué', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
      ...baseRestaurant,
      phoneNumber: '+000test-rest',
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurant/onboarding',
      headers: { authorization: 'Bearer test' },
      payload: { action: 'complete', task: 'phone' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/numéro Sokar attribué/i);
    expect(db.restaurant.update).not.toHaveBeenCalled();
  });

  it('déclenche un vrai appel test Telnyx vers le téléphone du gérant', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(baseRestaurant as any);
    vi.mocked(db.restaurant.update).mockResolvedValue({
      ...baseRestaurant,
      firstCallAt: new Date('2099-06-19T12:00:00.000Z'),
    } as any);
    vi.mocked(placeOutboundCall).mockResolvedValue({ callControlId: 'call-control-1' });

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/test-call',
      headers: { authorization: 'Bearer test', host: 'api.test.local' },
      payload: { phoneNumber: '+33611112222' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      callControlId: 'call-control-1',
      message: 'Appel test déclenché. Tu vas recevoir un appel sous quelques secondes.',
    });
    expect(placeOutboundCall).toHaveBeenCalledWith(
      '+33611112222',
      expect.objectContaining({
        webhookUrl: 'http://api.test.local/voice/stream',
        clientState: expect.objectContaining({
          kind: 'onboarding_test_call',
          restaurantId: 'test-rest-1',
          targetManagerPhone: '+33611112222',
        }),
        timeoutSecs: 30,
      }),
    );
    expect(db.restaurant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-rest-1' },
        data: expect.objectContaining({ firstCallAt: expect.any(Date) }),
      }),
    );
  });

  it('ne marque pas first_call quand Telnyx échoue à déclencher l’appel test', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(baseRestaurant as any);
    vi.mocked(placeOutboundCall).mockRejectedValue(new Error('Telnyx unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/test-call',
      headers: { authorization: 'Bearer test', host: 'api.test.local' },
      payload: { phoneNumber: '+33611112222' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/appel test/i);
    expect(db.restaurant.update).not.toHaveBeenCalled();
  });

  it('planifie une relance J+3 quand une étape onboarding avance sans être terminé', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
      ...baseRestaurant,
      openingHours: {},
      googleRefreshToken: null,
      personality: null,
      phoneNumber: '+000test-rest',
    } as any);
    vi.mocked(db.restaurant.update).mockResolvedValue({
      ...baseRestaurant,
      openingHours: {},
      googleRefreshToken: null,
      personality: null,
      phoneNumber: '+000test-rest',
      onboardingTasks: {},
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurant/onboarding',
      headers: { authorization: 'Bearer test' },
      payload: { action: 'complete', task: 'restaurant' },
    });

    expect(res.statusCode).toBe(200);
    expect(queues.onboarding.add).toHaveBeenCalledWith(
      'reengagement-stalled-test-rest-1',
      { restaurantId: 'test-rest-1', type: 'stalled' },
      expect.objectContaining({ jobId: 'reengagement-stalled-test-rest-1' }),
    );
  });
});
