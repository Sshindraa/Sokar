/**
 * Tests d'intégration des routes OpenAI Reserve :
 *   - GET  /v1/businesses           : feed paginé
 *   - POST /v1/tools/restaurant_reservation : tool Apps SDK
 *   - GET  /v1/tools                : discovery
 *
 * Vérifie le contrat Apps SDK : _meta.ui.resourceUri = "ui://widget/restaurant-reservation.html"
 */

import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { env } from '../../../env';
import { signOpenaiReserveRequest } from '../openai-reserve/signature';

describe('OpenAI Reserve routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Par défaut le HMAC est désactivé pour les tests existants.
    env.OPENAI_RESERVE_HMAC_KEY = undefined;
  });

  function signedFeedUrl(query: Record<string, string | number>, secret: string): string {
    const signature = signOpenaiReserveRequest('GET', '/v1/businesses', query, secret);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      params.append(key, String(value));
    }
    params.append('signature', signature);
    return `/v1/businesses?${params.toString()}`;
  }

  describe('GET /v1/businesses', () => {
    it('retourne un feed paginé avec checksum et pagination', async () => {
      vi.mocked(db.restaurant.count).mockResolvedValue(42);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce([
        {
          id: 'r-1',
          name: 'Le Bistrot',
          slug: 'le-bistrot',
          formattedAddress: '1 rue de Paris, 75001 Paris, France',
          phoneE164: '+33****0000',
          websiteUrl: 'https://bistrot.example',
          lat: { toNumber: () => 48.86 },
          lng: { toNumber: () => 2.35 },
          cuisineType: ['french'],
          priceRange: 2,
          openingHours: { lun: ['12:00-14:30'] },
        },
      ] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/businesses?page=1&page_size=20',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checksum).toBe(true);
      expect(body.page).toBe(1);
      expect(body.page_size).toBe(20);
      expect(body.total).toBe(42);
      expect(body.total_pages).toBe(3);
      expect(body.businesses).toHaveLength(1);
      expect(body.businesses[0].id).toBe('r-1');
      expect(body.businesses[0].name).toBe('Le Bistrot');
      expect(body.businesses[0].location.latitude).toBe(48.86);
      expect(body.businesses[0].location.longitude).toBe(2.35);
      expect(body.businesses[0].phone_number).toContain('+33');
    });

    it('filtre openaiReserveEnabled + champs requis', async () => {
      (
        vi.mocked(db.restaurant.count) as unknown as Mock<(...args: unknown[]) => unknown>
      ).mockImplementation((args: unknown) => {
        const { where } = args as { where: Record<string, unknown> };
        // On s'assure que la query Prisma contient bien le filtre
        expect(where.openaiReserveEnabled).toBe(true);
        expect((where.lat as Record<string, unknown>).not).toBeNull();
        expect((where.lng as Record<string, unknown>).not).toBeNull();
        expect((where.phoneE164 as Record<string, unknown>).not).toBeNull();
        expect((where.websiteUrl as Record<string, unknown>).not).toBeNull();
        expect((where.formattedAddress as Record<string, unknown>).not).toBeNull();
        return 0;
      });
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>,
      );

      const app = await getApp();
      const res = await app.inject({ method: 'GET', url: '/v1/businesses' });
      expect(res.statusCode).toBe(200);
    });

    it('accepte et valide changes_token', async () => {
      vi.mocked(db.restaurant.count).mockResolvedValue(0);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>,
      );

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/businesses?changes_token=sync_2026_03_10',
      });
      expect(res.statusCode).toBe(200);
    });

    it('refuse 400 sur query invalide', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/businesses?page_size=999',
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuse 401 si HMAC configuré et signature manquante', async () => {
      env.OPENAI_RESERVE_HMAC_KEY = 'test-openai-reserve-hmac-key-32-chars';
      vi.mocked(db.restaurant.count).mockResolvedValue(0);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>,
      );

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/businesses?page=1&page_size=20',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('signature');
    });

    it('refuse 401 si HMAC configuré et signature invalide', async () => {
      env.OPENAI_RESERVE_HMAC_KEY = 'test-openai-reserve-hmac-key-32-chars';
      vi.mocked(db.restaurant.count).mockResolvedValue(0);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>,
      );

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/businesses?page=1&page_size=20&signature=invalid',
      });
      expect(res.statusCode).toBe(401);
    });

    it('accepte le feed avec une signature HMAC valide', async () => {
      const hmacKey = 'test-openai-reserve-hmac-key-32-chars';
      env.OPENAI_RESERVE_HMAC_KEY = hmacKey;
      vi.mocked(db.restaurant.count).mockResolvedValue(42);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce([
        {
          id: 'r-1',
          name: 'Le Bistrot',
          slug: 'le-bistrot',
          formattedAddress: '1 rue de Paris, 75001 Paris, France',
          phoneE164: '+33****0000',
          websiteUrl: 'https://bistrot.example',
          lat: { toNumber: () => 48.86 },
          lng: { toNumber: () => 2.35 },
          cuisineType: ['french'],
          priceRange: 2,
          openingHours: { lun: ['12:00-14:30'] },
        },
      ] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: signedFeedUrl({ page: 1, page_size: 20 }, hmacKey),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.businesses).toHaveLength(1);
      expect(body.businesses[0].id).toBe('r-1');
    });

    it('accepte une signature HMAC statique compatible pagination OpenAI', async () => {
      const hmacKey = 'test-openai-reserve-hmac-key-32-chars';
      env.OPENAI_RESERVE_HMAC_KEY = hmacKey;
      vi.mocked(db.restaurant.count).mockResolvedValue(42);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce([
        {
          id: 'r-1',
          name: 'Le Bistrot',
          slug: 'le-bistrot',
          formattedAddress: '1 rue de Paris, 75001 Paris, France',
          phoneE164: '+33****0000',
          websiteUrl: 'https://bistrot.example',
          lat: { toNumber: () => 48.86 },
          lng: { toNumber: () => 2.35 },
          cuisineType: ['french'],
          priceRange: 2,
          openingHours: { lun: ['12:00-14:30'] },
        },
      ] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>);

      const staticSignature = signOpenaiReserveRequest('GET', '/v1/businesses', {}, hmacKey);
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/v1/businesses?page=1&page_size=20&signature=${staticSignature}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().businesses).toHaveLength(1);
    });

    it('accepte le feed sans signature si HMAC non configuré', async () => {
      // env.OPENAI_RESERVE_HMAC_KEY reste undefined (reset beforeEach).
      vi.mocked(db.restaurant.count).mockResolvedValue(0);
      vi.mocked(db.restaurant.findMany).mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof db.restaurant.findMany>>,
      );

      const app = await getApp();
      const res = await app.inject({ method: 'GET', url: '/v1/businesses' });
      expect(res.statusCode).toBe(200);
    });

    // Note : le rate limit (10 req/min/IP) est configuré via
    // config: { rateLimit: { max: 10, timeWindow: '1 minute' } } dans
    // openai-reserve.routes.ts. Un test fonctionnel 429 complet est difficile
    // à isoler car le store mémoire du rate limiter est partagé entre tous
    // les tests (singleton app via getApp). Le rate limit est vérifié en
    // production par le plugin @fastify/rate-limit.
  });

  describe('POST /v1/tools/restaurant_reservation', () => {
    it('retourne _meta.ui.resourceUri conforme spec', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce({
        id: 'r-1',
        name: 'Le Bistrot',
        formattedAddress: '1 rue de Paris, 75001 Paris, France',
        lat: 48.86,
        lng: 2.35,
        openaiReserveEnabled: true,
        city: 'Paris',
        region: 'IDF',
        postalCode: '75001',
        countryCode: 'FR',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tools/restaurant_reservation',
        payload: { restaurant_id: 'r-1' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body._meta.ui.resourceUri).toBe('ui://widget/restaurant-reservation.html');
      expect(body.result.restaurant_id).toBe('r-1');
      expect(body.result.restaurant_name).toBe('Le Bistrot');
      expect(body.result.widget_resource_url).toBeDefined();
    });

    it("utilise l'adresse optimistique si fournie", async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce({
        id: 'r-1',
        name: 'Le Bistrot',
        formattedAddress: null,
        lat: 48.86,
        lng: 2.35,
        openaiReserveEnabled: true,
        city: 'Paris',
        region: 'IDF',
        postalCode: '75001',
        countryCode: 'FR',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tools/restaurant_reservation',
        payload: {
          restaurant_id: 'r-1',
          restaurant_name: 'Le Bistrot (pré)',
          restaurant_address: {
            address: '5 rue de Lyon',
            city: 'Paris',
            state: 'IDF',
            zipcode: '75012',
            country: 'FR',
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.result.restaurant_name).toBe('Le Bistrot (pré)');
      expect(body.result.restaurant_address.line1).toBe('5 rue de Lyon');
    });

    it('refuse 404 si restaurant non trouvé ou opt-in désactivé', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce(null);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tools/restaurant_reservation',
        payload: { restaurant_id: 'r-unknown' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('refuse 400 sur input invalide', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tools/restaurant_reservation',
        payload: { restaurant_id: '' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/tools', () => {
    it('liste le tool restaurant_reservation avec _meta', async () => {
      const app = await getApp();
      const res = await app.inject({ method: 'GET', url: '/v1/tools' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('restaurant_reservation');
      expect(body.tools[0]._meta.ui.resourceUri).toBe('ui://widget/restaurant-reservation.html');
      expect(body.tools[0].input_schema.required).toContain('restaurant_id');
    });
  });
});
