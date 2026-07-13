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
  managerEmail: 'restaurant@sokar.tech',
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
    } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);

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

  it('déclenche un vrai appel test Telnyx vers le téléphone du restaurant', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      baseRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(db.restaurant.update).mockResolvedValue({
      ...baseRestaurant,
      firstCallAt: new Date('2099-06-19T12:00:00.000Z'),
    } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);
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
      message: 'Appel test déclenché. Vous allez recevoir un appel sous quelques secondes.',
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
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      baseRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(placeOutboundCall).mockRejectedValue(new Error('Telnyx unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/test-call',
      headers: { authorization: 'Bearer test', host: 'api.test.local' },
      payload: { phoneNumber: '+33611112222' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('TELNYX_FAILED');
    expect(res.json().error).toMatch(/appel test/i);
    expect(db.restaurant.update).not.toHaveBeenCalled();
  });

  it('renvoie 409 + code NO_PHONE_ASSIGNED quand test-call est appelé sans numéro Sokar', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
      ...baseRestaurant,
      phoneNumber: '+000test-rest',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/test-call',
      headers: { authorization: 'Bearer test', host: 'api.test.local' },
      payload: { phoneNumber: '+33611112222' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NO_PHONE_ASSIGNED');
    expect(res.json().error).toMatch(/numéro Sokar attribué/i);
    expect(placeOutboundCall).not.toHaveBeenCalled();
  });

  it('planifie une relance J+3 quand une étape onboarding avance sans être terminé', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
      ...baseRestaurant,
      openingHours: {},
      googleRefreshToken: null,
      personality: null,
      phoneNumber: '+000test-rest',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);
    vi.mocked(db.restaurant.update).mockResolvedValue({
      ...baseRestaurant,
      openingHours: {},
      googleRefreshToken: null,
      personality: null,
      phoneNumber: '+000test-rest',
      onboardingTasks: {},
    } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);

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

  describe('GET /restaurants/check-slug', () => {
    it('renvoie 400 si le paramètre slug est absent', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/check-slug',
        headers: { authorization: 'Bearer test' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/slug requis/i);
    });

    it('renvoie 400 si le format du slug est invalide', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/check-slug',
        query: { slug: 'Bistrot_Sokar' },
        headers: { authorization: 'Bearer test' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/format/i);
    });

    it('renvoie available: true si le slug est disponible ou appartient au restaurant courant', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/check-slug',
        query: { slug: 'bistrot-dispo' },
        headers: { authorization: 'Bearer test' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ available: true });
    });

    it('renvoie available: false si le slug est déjà utilisé par un autre restaurant', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: 'autre-rest-id',
        slug: 'bistrot-pris',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/check-slug',
        query: { slug: 'bistrot-pris' },
        headers: { authorization: 'Bearer test' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ available: false });
    });
  });

  describe('PATCH /restaurants/:id/connect', () => {
    it('renvoie 409 si le slug est déjà utilisé par un autre restaurant', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: 'autre-rest-id',
        slug: 'slug-pris',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.update>>);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/connect',
        headers: { authorization: 'Bearer test' },
        payload: { slug: 'slug-pris' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/déjà utilisé/i);
    });

    it('met à jour les infos du restaurant et de ses exposure settings', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);

      vi.mocked(db.restaurantExposureSettings.upsert).mockResolvedValue({
        restaurantId: 'test-rest-1',
        capacitySpecials: {},
      } as unknown as Awaited<ReturnType<typeof db.restaurantExposureSettings.upsert>>);

      const updatedRest = {
        ...baseRestaurant,
        slug: 'nouveau-slug',
        description: 'Bistrot sympa',
        coverImageUrl: 'http://img.url',
      };

      const updatedSettings = {
        restaurantId: 'test-rest-1',
        maxPartySize: 8,
        connectPublished: true,
        capacitySpecials: { totalCapacity: 35 },
      };

      vi.mocked(db.restaurant.update).mockResolvedValue(
        updatedRest as unknown as Awaited<ReturnType<typeof db.restaurant.update>>,
      );
      vi.mocked(db.restaurantExposureSettings.update).mockResolvedValue(
        updatedSettings as unknown as Awaited<
          ReturnType<typeof db.restaurantExposureSettings.update>
        >,
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/connect',
        headers: { authorization: 'Bearer test' },
        payload: {
          slug: 'nouveau-slug',
          description: 'Bistrot sympa',
          coverImageUrl: 'http://img.url',
          maxPartySize: 8,
          connectPublished: true,
          capacitySpecials: { totalCapacity: 35 },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        restaurant: expect.objectContaining({ slug: 'nouveau-slug', description: 'Bistrot sympa' }),
        exposureSettings: expect.objectContaining({ maxPartySize: 8, connectPublished: true }),
      });
    });
  });

  describe('POST /restaurants/:id/images', () => {
    it('ajoute une image et met à jour coverImageUrl si isCover est true', async () => {
      const app = await getApp();
      vi.mocked(db.restaurantImage.create).mockResolvedValue({
        id: 'img-1',
        restaurantId: 'test-rest-1',
        url: 'http://image.url/cover.jpg',
        isCover: true,
      } as unknown as Awaited<ReturnType<typeof db.restaurantImage.create>>);

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/images',
        headers: { authorization: 'Bearer test' },
        payload: {
          url: 'http://image.url/cover.jpg',
          isCover: true,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(expect.objectContaining({ id: 'img-1', isCover: true }));
      expect(db.restaurantImage.updateMany).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1', isCover: true },
        data: { isCover: false },
      });
      expect(db.restaurant.update).toHaveBeenCalledWith({
        where: { id: 'test-rest-1' },
        data: { coverImageUrl: 'http://image.url/cover.jpg' },
      });
    });
  });
});
