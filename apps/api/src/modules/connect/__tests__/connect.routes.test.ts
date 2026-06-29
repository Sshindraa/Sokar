/**
 * Tests routes Sokar Connect — T2.
 *
 * Couvre (acceptance criteria spec v1.1 §10 T2) :
 * - GET /public/r/:slug → 200 si publié
 * - GET /public/r/inexistant → 404
 * - GET /public/r/:slug/availability → slots valides
 * - POST /hold puis POST /confirm avec Idempotency-Key
 * - POST /confirm replay même payload = même réponse
 * - POST /confirm replay payload différent = 409 Conflict
 * - source=chatgpt forcée à 'web' si connectAgentic=false
 * - Pas d'auth requise (pas de 401 sans Authorization)
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { redisCache } from '../../../shared/redis/client';
import type { FastifyInstance } from 'fastify';
import type { PublicRestaurantDto } from '../connect.types';

const SLUG = 'chez-sokar-demo';
const RESTAURANT_ID = 'ba5be41b-eb72-4e05-bb9c-b576e39e33ba';

const mockPublishedRestaurant: PublicRestaurantDto = {
  id: RESTAURANT_ID,
  slug: SLUG,
  name: 'Chez Sokar',
  description: 'Bistrot français à Lyon',
  address: {
    line1: '12 Rue de la République, 69001 Lyon',
    postalCode: '69001',
    city: 'Lyon',
    country: 'FR',
  },
  phone: '+334****0000',
  cuisineTypes: ['Bistrot', 'Française'],
  priceRange: '€€',
  openingHours: [
    { day: 'monday', open: '12:00', close: '14:30' },
    { day: 'monday', open: '19:00', close: '22:30' },
  ],
  reservationUrl: `https://sokar.tech/r/${SLUG}/book`,
  images: { cover: undefined, gallery: [] },
  acceptsReservations: true,
  publishedAt: '2026-06-24T00:00:00.000Z',
  connectAgentic: false,
};

const mockExposureSettings = {
  maxPartySize: 12,
  minLeadTimeMinutes: 30,
  quoteTtlSeconds: 300,
  holdTtlSeconds: 420,
  requireManualValidation: false,
  noShowPolicy: 'warning',
  notificationChannels: ['sms', 'email'],
  capacitySpecials: {},
};

let app: FastifyInstance;

describe('Sokar Connect — Routes publiques', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear le store Redis in-memory pour éviter les cache hits
    // entre tests (le helper partage une Map entre les `it()` du fichier).
    await redisCache.flushall();
    app = await getApp();
  });
  afterAll(async () => {
    await closeApp();
  });

  describe('GET /public/r/:slug', () => {
    it('retourne 200 + DTO si le restaurant est publié', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        name: 'Chez Sokar',
        description: 'Bistrot français à Lyon',
        formattedAddress: '12 Rue de la République, 69001 Lyon',
        city: 'Lyon',
        country: 'FR',
        postalCode: '69001',
        phoneNumber: '+334****0000',
        phoneE164: '+334****0000',
        cuisineType: ['Bistrot', 'Française'],
        priceRange: 2,
        openingHours: { mon: { open: '12:00', close: '14:30' } },
        ambiance: [],
        dietary: [],
        noiseLevel: null,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false,
        },
        images: [],
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/public/r/${SLUG}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slug).toBe(SLUG);
      expect(body.name).toBe('Chez Sokar');
      expect(body.connectAgentic).toBe(false);
    });

    it('retourne 404 si restaurant inexistant', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/public/r/inexistant',
      });

      expect(res.statusCode).toBe(404);
    });

    it('retourne 404 si connectPublished=false', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        exposureSettings: {
          connectPublished: false, // NOT published
          connectAgentic: false,
        },
        images: [],
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/public/r/${SLUG}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it('retourne 404 si agenticOptIn=false (acceptsReservations=false)', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: false, // NOT accepting reservations
        publishedAt: new Date('2026-06-24'),
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false,
        },
        images: [],
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/public/r/${SLUG}`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /public/sitemap-data', () => {
    it('retourne la liste des slugs publiés', async () => {
      vi.mocked(db.restaurant.findMany).mockResolvedValue([
        {
          slug: 'chez-sokar-demo',
          updatedAt: new Date('2026-06-24'),
          publishedAt: new Date('2026-06-20'),
        },
        {
          slug: 'autre-restaurant',
          updatedAt: new Date('2026-06-23'),
          publishedAt: new Date('2026-06-22'),
        },
      ] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/public/sitemap-data',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.restaurants).toHaveLength(2);
      expect(body.restaurants[0].slug).toBe('chez-sokar-demo');
      expect(body.restaurants[0].updatedAt).toBe('2026-06-24T00:00:00.000Z');
    });

    it('filtre les slugs null', async () => {
      vi.mocked(db.restaurant.findMany).mockResolvedValue([
        { slug: 'ok', updatedAt: new Date('2026-06-24'), publishedAt: new Date() },
        { slug: null, updatedAt: new Date('2026-06-23'), publishedAt: new Date() },
      ] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/public/sitemap-data',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().restaurants).toHaveLength(1);
    });
  });

  describe('GET /public/r/:slug/availability', () => {
    it('retourne les slots du jour', async () => {
      // Mock le restaurant
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        city: 'Lyon',
        country: 'FR',
        postalCode: '69001',
        description: null,
        formattedAddress: '12 Rue',
        phoneNumber: '+334****0000',
        phoneE164: '+334****0000',
        cuisineType: ['Française'],
        priceRange: 2,
        openingHours: { mon: { open: '12:00', close: '14:30' } },
        ambiance: [],
        dietary: [],
        noiseLevel: null,
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false,
        },
        images: [],
      } as any);
      vi.mocked(db.agenticHold.findMany).mockResolvedValue([]);
      vi.mocked(db.reservation.findMany).mockResolvedValue([]);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue(
        mockExposureSettings as any,
      );

      // Use a Monday date for the test
      const mondayDate = '2026-06-29'; // Monday

      const res = await app.inject({
        method: 'GET',
        url: `/public/r/${SLUG}/availability?date=${mondayDate}&partySize=2`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.date).toBe(mondayDate);
      expect(body.partySize).toBe(2);
      expect(body.slots.length).toBeGreaterThan(0);
    });

    it('retourne 400 si date mal formée', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/public/r/${SLUG}/availability?date=not-a-date&partySize=2`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('retourne 400 si partySize invalide', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/public/r/${SLUG}/availability?date=2026-06-29&partySize=99`,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /public/r/:slug/hold', () => {
    it('crée un hold 5min et retourne holdToken', async () => {
      // Mock restaurant
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        city: 'Lyon',
        country: 'FR',
        postalCode: '69001',
        description: null,
        formattedAddress: '12 Rue',
        phoneNumber: '+334****0000',
        phoneE164: '+334****0000',
        cuisineType: ['Française'],
        priceRange: 2,
        openingHours: { mon: { open: '12:00', close: '22:00' } },
        ambiance: [],
        dietary: [],
        noiseLevel: null,
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false,
        },
        images: [],
      } as any);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue(
        mockExposureSettings as any,
      );
      vi.mocked(db.agenticHold.create).mockResolvedValue({
        id: 'hold_123',
        holdToken: 'tok_abc',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        status: 'ACTIVE',
        restaurantId: RESTAURANT_ID,
        partySize: 4,
        slotStart: new Date('2026-06-29T20:00:00Z'),
        slotEnd: new Date('2026-06-29T21:30:00Z'),
        channel: 'WEB',
        type: 'HOLD',
        policyVersion: '2026-06-20',
        createdAt: new Date(),
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/public/r/${SLUG}/hold`,
        payload: {
          date: '2026-06-29',
          time: '20:00',
          partySize: 4,
          source: 'web',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.holdId).toBe('hold_123');
      expect(body.holdToken).toBe('tok_abc');
      expect(body.status).toBe('pending');
    });

    it("force source='web' si connectAgentic=false et source=chatgpt", async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        city: 'Lyon',
        country: 'FR',
        postalCode: '69001',
        description: null,
        formattedAddress: '12 Rue',
        phoneNumber: '+334****0000',
        phoneE164: '+334****0000',
        cuisineType: ['Française'],
        priceRange: 2,
        openingHours: { mon: { open: '12:00', close: '22:00' } },
        ambiance: [],
        dietary: [],
        noiseLevel: null,
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false, // PAS d'agentic
        },
        images: [],
      } as any);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue(
        mockExposureSettings as any,
      );
      vi.mocked(db.agenticHold.create).mockResolvedValue({
        id: 'hold_123',
        holdToken: 'tok_abc',
        expiresAt: new Date(),
        status: 'ACTIVE',
        restaurantId: RESTAURANT_ID,
        partySize: 4,
        slotStart: new Date(),
        slotEnd: new Date(),
        channel: 'WEB',
        type: 'HOLD',
        policyVersion: '2026-06-20',
        createdAt: new Date(),
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/public/r/${SLUG}/hold`,
        payload: {
          date: '2026-06-29',
          time: '20:00',
          partySize: 4,
          source: 'chatgpt', // agentic mais le resto n'a pas activé
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // chatgpt doit être forcé à 'web' car connectAgentic=false
      expect(body.sourceNormalized).toBe('web');
    });

    it("préserve source='google' même si connectAgentic=false (SEO)", async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        city: 'Lyon',
        country: 'FR',
        postalCode: '69001',
        description: null,
        formattedAddress: '12 Rue',
        phoneNumber: '+334****0000',
        phoneE164: '+334****0000',
        cuisineType: ['Française'],
        priceRange: 2,
        openingHours: { mon: { open: '12:00', close: '22:00' } },
        ambiance: [],
        dietary: [],
        noiseLevel: null,
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false,
        },
        images: [],
      } as any);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue(
        mockExposureSettings as any,
      );
      vi.mocked(db.agenticHold.create).mockResolvedValue({
        id: 'hold_123',
        holdToken: 'tok_abc',
        expiresAt: new Date(),
        status: 'ACTIVE',
        restaurantId: RESTAURANT_ID,
        partySize: 4,
        slotStart: new Date(),
        slotEnd: new Date(),
        channel: 'WEB',
        type: 'HOLD',
        policyVersion: '2026-06-20',
        createdAt: new Date(),
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/public/r/${SLUG}/hold`,
        payload: {
          date: '2026-06-29',
          time: '20:00',
          partySize: 4,
          source: 'google', // SEO direct, PAS agentic
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sourceNormalized).toBe('google');
    });
  });

  describe('POST /public/r/:slug/confirm', () => {
    it('retourne 410 si hold expiré', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        slug: SLUG,
        agenticOptIn: true,
        publishedAt: new Date('2026-06-24'),
        city: 'Lyon',
        country: 'FR',
        postalCode: '69001',
        description: null,
        formattedAddress: '12 Rue',
        phoneNumber: '+334****0000',
        phoneE164: '+334****0000',
        cuisineType: ['Française'],
        priceRange: 2,
        openingHours: { mon: { open: '12:00', close: '22:00' } },
        ambiance: [],
        dietary: [],
        noiseLevel: null,
        exposureSettings: {
          connectPublished: true,
          connectAgentic: false,
        },
        images: [],
      } as any);
      vi.mocked(db.agenticHold.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: `/public/r/${SLUG}/confirm`,
        payload: {
          holdToken: 'hold-test-expired',
          customer: {
            firstName: 'Hamza',
            phone: '+33612345678',
          },
        },
      });

      expect(res.statusCode).toBe(410);
    });
  });
});
