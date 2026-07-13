import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { constructWebhookEvent } from '../stripe.service';
import { checkRateLimit } from '../../../shared/redis/rate-limit';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service';
import { ReservationService } from '../../agentic-reservations/core/reservation.service';

function d(value: number) {
  return new Prisma.Decimal(value);
}

const AUTH = { authorization: 'Bearer fake-token' };
const RESTAURANT_ID = 'test-rest-1';

describe('gift-card routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('admin routes', () => {
    it('retourne 401 sans auth', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/restaurants/${RESTAURANT_ID}/gift-cards`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('liste les cartes cadeaux du restaurant', async () => {
      vi.mocked(db.giftCard.findMany).mockResolvedValue([
        {
          id: 'gc-1',
          restaurantId: RESTAURANT_ID,
          code: 'abc-1234-5678-9012',
          amount: d(100),
          remainingAmount: d(100),
          currency: 'EUR',
          status: 'ACTIVE',
          createdBy: 'DASHBOARD',
          purchaseReference: 'manual',
          redemptions: [],
        } as unknown as Awaited<ReturnType<typeof db.giftCard.findMany>>[number],
      ]);
      vi.mocked(db.giftCard.count).mockResolvedValue(1);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/restaurants/${RESTAURANT_ID}/gift-cards`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].code).toContain('****');
    });

    it('crée une carte cadeau manuelle', async () => {
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234-5678-9012',
        amount: d(100),
        remainingAmount: d(100),
        currency: 'EUR',
        status: 'ACTIVE',
        createdBy: 'DASHBOARD',
        purchaseReference: 'manual',
        redemptions: [],
      } as unknown as Awaited<ReturnType<typeof db.giftCard.create>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/restaurants/${RESTAURANT_ID}/gift-cards`,
        headers: AUTH,
        payload: { amount: 100, recipientName: 'Alice', recipientEmail: 'alice@example.com' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.amount).toBe(100);
      expect(body.createdBy).toBe('DASHBOARD');
    });

    it('annule une carte cadeau', async () => {
      vi.mocked(db.giftCard.findFirst).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        status: 'ACTIVE',
        amount: d(100),
        remainingAmount: d(100),
        currency: 'EUR',
        stripePaymentIntentId: null,
        redemptions: [],
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findFirst>>);
      vi.mocked(db.giftCard.update).mockResolvedValue({
        id: 'gc-1',
        status: 'CANCELLED',
        remainingAmount: d(0),
        amount: d(100),
        currency: 'EUR',
        code: 'abc-1234',
        createdBy: 'DASHBOARD',
        purchaseReference: 'manual',
        redemptions: [],
      } as unknown as Awaited<ReturnType<typeof db.giftCard.update>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/restaurants/${RESTAURANT_ID}/gift-cards/gc-1/cancel`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('CANCELLED');
    });

    it('retourne les stats', async () => {
      (
        vi.mocked(db.giftCard.aggregate) as unknown as Mock<(...args: unknown[]) => unknown>
      ).mockImplementation((args: unknown) => {
        const a = args as { _sum?: { amount?: true; remainingAmount?: true } };
        if (a._sum?.amount) {
          return { _sum: { amount: d(150) } };
        }
        if (a._sum?.remainingAmount) {
          return { _sum: { remainingAmount: d(50) } };
        }
        return { _sum: null };
      });
      (
        vi.mocked(db.giftCard.count) as unknown as Mock<(...args: unknown[]) => unknown>
      ).mockImplementation((args: unknown) => {
        const a = args as { where?: { status?: string; packId?: string } };
        if (a?.where?.status === 'REDEEMED') return 1;
        if (a?.where?.status === 'ACTIVE') return 1;
        if (a?.where?.packId) return 0;
        return 2;
      });

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/restaurants/${RESTAURANT_ID}/gift-cards/stats`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalSoldAmount).toBe(150);
      expect(body.totalCount).toBe(2);
    });
  });

  describe('public routes', () => {
    it('vérifie le solde d une carte cadeau', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234',
        amount: d(100),
        remainingAmount: d(60),
        status: 'ACTIVE',
        expiresAt: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        name: 'Chez Sokar',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/check',
        payload: { code: 'abc-1234' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(true);
      expect(body.giftCard.remainingAmount).toBe(60);
      expect(body.giftCard.restaurantName).toBe('Chez Sokar');
    });

    it('retourne une recommandation', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/recommend',
        payload: { priceRange: '€€', occasion: 'anniversaire', partySize: 2 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.amount).toBe('number');
      expect(body.messageSuggestion).toContain('Offrez');
    });

    it('achète une carte cadeau avec paiement Stripe', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        name: 'Test Resto',
        giftCardCommissionRate: d(0.05),
        giftCardMinimumAmount: 10,
        managerEmail: 'manager@test.com',
        managerPhone: '+33100000000',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234-5678-9012',
        amount: d(120),
        remainingAmount: d(120),
        currency: 'EUR',
        status: 'ACTIVE',
        createdBy: 'CLIENT',
        purchaseReference: 'pi_test',
        stripePaymentIntentId: 'pi_test',
        stripePaymentStatus: 'succeeded',
        sokarCommissionAmount: d(6),
        redemptions: [],
      } as unknown as Awaited<ReturnType<typeof db.giftCard.create>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/purchase',
        payload: {
          restaurantId: RESTAURANT_ID,
          paymentIntentId: 'pi_test',
          amount: 120,
          recipientName: 'Alice',
          recipientEmail: 'alice@example.com',
          senderName: 'Bob',
          senderEmail: 'bob@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.amount).toBe(120);
      expect(body.code).toBeDefined();
      expect(body.code).not.toContain('****');
      expect(body.stripePaymentStatus).toBe('succeeded');
      expect(body.pdfUrl).toContain('/pdf');
    });

    it('achète un pack expérience avec paiement Stripe', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        name: 'Test Resto',
        giftCardCommissionRate: d(0.05),
        giftCardMinimumAmount: 10,
        managerEmail: 'manager@test.com',
        managerPhone: '+33100000000',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
        amount: d(150),
      } as unknown as Awaited<ReturnType<typeof db.giftCardPack.findFirst>>);
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234-5678-9012',
        amount: d(150),
        remainingAmount: d(150),
        currency: 'EUR',
        status: 'ACTIVE',
        createdBy: 'CLIENT',
        purchaseReference: 'pi_test',
        stripePaymentIntentId: 'pi_test',
        stripePaymentStatus: 'succeeded',
        sokarCommissionAmount: d(7.5),
        packId: 'pack-1',
        redemptions: [],
      } as unknown as Awaited<ReturnType<typeof db.giftCard.create>>);
      vi.mocked(db.giftCardPack.findUnique).mockResolvedValue({
        id: 'pack-1',
        name: 'Menu dégustation',
      } as unknown as Awaited<ReturnType<typeof db.giftCardPack.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/purchase',
        payload: {
          restaurantId: RESTAURANT_ID,
          paymentIntentId: 'pi_test',
          packId: 'pack-1',
          recipientName: 'Alice',
          recipientEmail: 'alice@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.amount).toBe(150);
      expect(body.packName).toBe('Menu dégustation');
    });

    it('crée un payment intent Stripe', async () => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        giftCardMinimumAmount: 10,
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/payment-intent',
        payload: {
          restaurantId: RESTAURANT_ID,
          amount: 100,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paymentIntentId).toBeDefined();
      expect(body.clientSecret).toBeDefined();
    });

    it("télécharge le PDF d'une carte cadeau", async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234-5678-9012',
        amount: d(100),
        remainingAmount: d(100),
        currency: 'EUR',
        status: 'ACTIVE',
        validityMonths: 12,
        message: 'Joyeux anniversaire',
        occasion: 'Anniversaire',
        senderName: 'Bob',
        recipientName: 'Alice',
        expiresAt: new Date('2027-01-01'),
        restaurant: { name: 'Test Resto' },
        pack: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/public/gift-cards/abc-1234-5678-9012/pdf',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it('propose des créneaux pour une carte cadeau', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        expiresAt: null,
        preferredPartySize: 2,
        preferredDate: new Date('2026-08-15'),
        pack: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockResolvedValue({
        restaurantId: RESTAURANT_ID,
        date: '2026-08-15',
        partySize: 2,
        slots: [
          { time: '19:00', available: true },
          { time: '19:30', available: true },
          { time: '20:00', available: true },
        ],
      });

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/abc-1234/slots',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slots).toHaveLength(3);
    });

    it('réserve un créneau avec la carte cadeau', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        expiresAt: null,
        preferredPartySize: 2,
        pack: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        timezone: 'Europe/Paris',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        requireManualValidation: false,
        capacitySpecials: null,
      } as unknown as Awaited<ReturnType<typeof db.restaurantExposureSettings.findUnique>>);
      vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockResolvedValue({
        restaurantId: RESTAURANT_ID,
        date: '2026-08-15',
        partySize: 2,
        slots: [
          { time: '19:00', available: true },
          { time: '19:30', available: true },
          { time: '20:00', available: true },
        ],
      });
      vi.spyOn(ReservationService.prototype, 'createReservation').mockResolvedValue({
        reservationId: 'res-1',
        state: 'CONFIRMED',
        reused: false,
        giftCardApplication: {
          reservationId: 'res-1',
          giftCardId: 'gc-1',
          appliedAmount: 100,
          remainingAmount: 0,
          paymentStatus: 'FULLY_COVERED',
          complementAmount: 0,
        },
      });

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/abc-1234/book',
        payload: {
          slotIndex: 0,
          customer: { firstName: 'Alice', lastName: 'Dupont', phone: '+33612345678' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reservationId).toBeDefined();
    });

    it('applique une carte cadeau à une réservation', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-1',
        restaurantId: RESTAURANT_ID,
        code: 'abc-1234',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        expiresAt: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.giftCard.update).mockResolvedValue({
        id: 'gc-1',
        remainingAmount: d(40),
        status: 'ACTIVE',
      } as unknown as Awaited<ReturnType<typeof db.giftCard.update>>);
      vi.mocked(db.$queryRaw).mockResolvedValue([
        { id: 'gc-1', remainingAmount: d(100), status: 'ACTIVE' },
      ] as unknown as Awaited<ReturnType<typeof db.$queryRaw>>);
      (
        vi.mocked(db.$transaction) as unknown as Mock<(...args: unknown[]) => unknown>
      ).mockImplementation(async (fn: unknown) => {
        if (Array.isArray(fn)) {
          return Promise.all(fn);
        }
        return (fn as (tx: unknown) => unknown)(db);
      });

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/apply',
        payload: {
          code: 'abc-1234',
          restaurantId: RESTAURANT_ID,
          reservationId: 'res-1',
          reservationAmount: 60,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appliedAmount).toBe(60);
      expect(body.remainingAmount).toBe(40);
      expect(body.paymentStatus).toBe('PARTIAL');
    });
  });

  describe('stripe webhook', () => {
    const WEBHOOK_METADATA = {
      restaurantId: RESTAURANT_ID,
      amount: '120',
      packId: '',
      occasion: 'Anniversaire',
      senderName: 'Bob',
      senderEmail: 'bob@example.com',
      senderPhone: '+33612345678',
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      recipientPhone: '+33687654321',
      message: 'Joyeux anniversaire',
      templateId: 'classic',
      customImageUrl: '',
      preferredDate: '',
      preferredTime: '',
      preferredPartySize: '',
    };

    function mockWebhookEvent(piId: string, metadata: Record<string, string>) {
      vi.mocked(constructWebhookEvent).mockResolvedValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: piId, metadata } },
      } as unknown as Awaited<ReturnType<typeof constructWebhookEvent>>);
    }

    it('recrée une carte cadeau depuis le webhook avec metadata complètes', async () => {
      mockWebhookEvent('pi_webhook_1', WEBHOOK_METADATA);
      vi.mocked(db.giftCard.findFirst).mockResolvedValue(null);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        id: RESTAURANT_ID,
        name: 'Test Resto',
        giftCardCommissionRate: d(0.05),
        giftCardMinimumAmount: 10,
        managerEmail: 'manager@test.com',
        managerPhone: '+33100000000',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gc-wb-1',
        restaurantId: RESTAURANT_ID,
        code: 'wb-1234-5678-9012',
        amount: d(120),
        remainingAmount: d(120),
        currency: 'EUR',
        status: 'ACTIVE',
        createdBy: 'CLIENT',
        purchaseReference: 'pi_webhook_1',
        stripePaymentIntentId: 'pi_webhook_1',
        stripePaymentStatus: 'succeeded',
        sokarCommissionAmount: d(6),
        redemptions: [],
      } as unknown as Awaited<ReturnType<typeof db.giftCard.create>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: {
          'stripe-signature': 't=123,v1=fake',
          'content-type': 'application/json',
        },
        payload: { type: 'payment_intent.succeeded' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
      expect(db.giftCard.create).toHaveBeenCalled();
    });

    it('ne recrée pas de doublon (idempotence par stripePaymentIntentId)', async () => {
      mockWebhookEvent('pi_existing', WEBHOOK_METADATA);
      vi.mocked(db.giftCard.findFirst).mockResolvedValue({
        id: 'gc-existing',
        restaurantId: RESTAURANT_ID,
        code: 'old-1234-5678-9012',
        amount: d(120),
        remainingAmount: d(120),
        status: 'ACTIVE',
        stripePaymentIntentId: 'pi_existing',
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findFirst>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: {
          'stripe-signature': 't=123,v1=fake',
          'content-type': 'application/json',
        },
        payload: { type: 'payment_intent.succeeded' },
      });

      expect(res.statusCode).toBe(200);
      // La carte ne doit pas être recréée
      expect(db.giftCard.create).not.toHaveBeenCalled();
    });

    it('retourne 200 sans recréer si les metadata sont incomplètes', async () => {
      mockWebhookEvent('pi_incomplete', { restaurantId: RESTAURANT_ID });
      vi.mocked(db.giftCard.findFirst).mockResolvedValue(null);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: {
          'stripe-signature': 't=123,v1=fake',
          'content-type': 'application/json',
        },
        payload: { type: 'payment_intent.succeeded' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.giftCard.create).not.toHaveBeenCalled();
    });

    it('retourne 400 sans stripe-signature header', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'payment_intent.succeeded' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── P3 — Crowdfunding ───────────────────────────────────────────
  describe('crowdfunding routes', () => {
    const CROWDFUNDING_CODE = 'crowd-test-code';
    const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    beforeEach(() => {
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        amount: d(0),
        remainingAmount: d(0),
        currency: 'EUR',
        status: 'ACTIVE',
        type: 'CROWDFUNDED',
        targetAmount: null,
        crowdfundedUntil: new Date(FUTURE_DATE),
        closedAt: null,
        purchasedAt: new Date(),
        expiresAt: null,
        validityMonths: 12,
        packId: null,
        preferredDate: null,
        preferredTime: null,
        preferredPartySize: null,
        senderName: 'Jean',
        senderEmail: 'jean@example.com',
        senderPhone: null,
        recipientName: 'Marie',
        recipientEmail: 'marie@example.com',
        recipientPhone: null,
        message: null,
        occasion: 'Cagnotte anniversaire Marie',
        customerId: null,
        createdBy: 'CLIENT',
        purchaseReference: 'crowdfunding',
        stripePaymentIntentId: null,
        stripePaymentStatus: 'pending',
        templateId: null,
        customImageUrl: null,
        sokarCommissionAmount: d(0),
      } as unknown as Awaited<ReturnType<typeof db.giftCard.create>>);
    });

    it('crée une cagnotte via POST /public/gift-cards/crowdfunding', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/crowdfunding',
        headers: { 'content-type': 'application/json' },
        payload: {
          restaurantId: RESTAURANT_ID,
          title: 'Cagnotte anniversaire Marie',
          recipientName: 'Marie',
          recipientEmail: 'marie@example.com',
          creatorName: 'Jean',
          creatorEmail: 'jean@example.com',
          crowdfundedUntil: FUTURE_DATE,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.code).toBe(CROWDFUNDING_CODE);
      expect(body.type).toBe('CROWDFUNDED');
      expect(body.title).toBe('Cagnotte anniversaire Marie');
      expect(db.giftCard.create).toHaveBeenCalled();
    });

    it('retourne 400 si la date butoir est dans le passé', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/crowdfunding',
        headers: { 'content-type': 'application/json' },
        payload: {
          restaurantId: RESTAURANT_ID,
          title: 'Test',
          recipientName: 'Marie',
          creatorName: 'Jean',
          creatorEmail: 'jean@example.com',
          crowdfundedUntil: '2020-01-01T00:00:00.000Z',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('retourne le statut public d une cagnotte', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        amount: d(0),
        remainingAmount: d(0),
        status: 'ACTIVE',
        type: 'CROWDFUNDED',
        targetAmount: null,
        crowdfundedUntil: new Date(FUTURE_DATE),
        closedAt: null,
        occasion: 'Cagnotte anniversaire Marie',
        senderName: 'Jean',
        senderEmail: 'jean@example.com',
        recipientName: 'Marie',
        message: 'Un message',
        contributions: [],
        restaurant: { name: 'Test Resto' },
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/public/gift-cards/crowdfunding/${CROWDFUNDING_CODE}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.code).toBe(CROWDFUNDING_CODE);
      expect(body.title).toBe('Cagnotte anniversaire Marie');
      expect(body.recipientName).toBe('Marie');
      expect(body.collectedAmount).toBe(0);
      expect(body.contributionsCount).toBe(0);
      expect(body.status).toBe('ACTIVE');
    });

    it('retourne 404 pour une cagnotte inexistante', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue(null);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/public/gift-cards/crowdfunding/nonexistent',
      });

      expect(res.statusCode).toBe(404);
    });

    it('crée un payment intent pour une contribution', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        type: 'CROWDFUNDED',
        status: 'ACTIVE',
        crowdfundedUntil: new Date(FUTURE_DATE),
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/public/gift-cards/crowdfunding/${CROWDFUNDING_CODE}/payment-intent`,
        headers: { 'content-type': 'application/json' },
        payload: {
          amount: 20,
          contributorName: 'Paul',
          contributorEmail: 'paul@example.com',
          isPublicName: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paymentIntentId).toBe('pi_test');
      expect(body.clientSecret).toBe('pi_t_s');
    });

    it('refuse un payment intent si la cagnotte est clôturée', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        type: 'CROWDFUNDED',
        status: 'CLOSED',
        crowdfundedUntil: new Date(FUTURE_DATE),
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/public/gift-cards/crowdfunding/${CROWDFUNDING_CODE}/payment-intent`,
        headers: { 'content-type': 'application/json' },
        payload: {
          amount: 20,
          contributorName: 'Paul',
          isPublicName: true,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('refuse un payment intent si la deadline est dépassée', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        type: 'CROWDFUNDED',
        status: 'ACTIVE',
        crowdfundedUntil: new Date('2020-01-01'),
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/public/gift-cards/crowdfunding/${CROWDFUNDING_CODE}/payment-intent`,
        headers: { 'content-type': 'application/json' },
        payload: {
          amount: 20,
          contributorName: 'Paul',
          isPublicName: true,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('confirme une contribution via POST /contribute', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        type: 'CROWDFUNDED',
        status: 'ACTIVE',
        crowdfundedUntil: new Date(FUTURE_DATE),
        occasion: 'Cagnotte',
        senderName: 'Jean',
        senderEmail: 'jean@example.com',
        recipientName: 'Marie',
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      // Mock pour la vérification atomique dans la transaction
      vi.mocked(db.giftCard.findFirst).mockResolvedValue({
        id: 'gc-crowd-1',
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findFirst>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        name: 'Test Resto',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.giftCardContribution.create).mockResolvedValue({
        id: 'contrib-1',
        giftCardId: 'gc-crowd-1',
        contributorName: 'Paul',
        contributorEmail: 'paul@example.com',
        amount: d(20),
        contributedAt: new Date(),
        stripePaymentIntentId: 'pi_test',
        isPublicName: true,
        message: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCardContribution.create>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/public/gift-cards/crowdfunding/${CROWDFUNDING_CODE}/contribute`,
        headers: { 'content-type': 'application/json' },
        payload: {
          paymentIntentId: 'pi_test',
          contributorName: 'Paul',
          contributorEmail: 'paul@example.com',
          amount: 20,
          isPublicName: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe('contrib-1');
      expect(body.amount).toBe(20);
      expect(db.giftCardContribution.create).toHaveBeenCalled();
    });

    it('clôture une cagnotte via POST /api/gift-cards/:id/close', async () => {
      const contributions = [
        { id: 'c1', amount: d(50), stripePaymentIntentId: 'pi_1' },
        { id: 'c2', amount: d(30), stripePaymentIntentId: 'pi_2' },
      ];

      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        type: 'CROWDFUNDED',
        status: 'ACTIVE',
        amount: d(0),
        remainingAmount: d(0),
        occasion: 'Cagnotte',
        recipientName: 'Marie',
        recipientEmail: 'marie@example.com',
        recipientPhone: '+33612345678',
        contributions,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        name: 'Test Resto',
        giftCardCommissionRate: d(0.05),
        managerEmail: 'manager@test.com',
        managerPhone: '+33100000000',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.giftCard.update).mockResolvedValue({
        id: 'gc-crowd-1',
        restaurantId: RESTAURANT_ID,
        code: CROWDFUNDING_CODE,
        type: 'SINGLE',
        status: 'ACTIVE',
        amount: d(76), // 80 - 4 (5% commission)
        remainingAmount: d(76),
        currency: 'EUR',
        sokarCommissionAmount: d(4),
        closedAt: new Date(),
        purchasedAt: new Date(),
        expiresAt: null,
        validityMonths: 12,
        packId: null,
        preferredDate: null,
        preferredTime: null,
        preferredPartySize: null,
        senderName: 'Jean',
        senderEmail: 'jean@example.com',
        senderPhone: null,
        recipientName: 'Marie',
        recipientEmail: 'marie@example.com',
        recipientPhone: '+33612345678',
        message: null,
        occasion: 'Cagnotte',
        customerId: null,
        createdBy: 'CLIENT',
        purchaseReference: 'crowdfunding',
        stripePaymentIntentId: null,
        stripePaymentStatus: 'pending',
        templateId: null,
        customImageUrl: null,
        targetAmount: null,
        crowdfundedUntil: new Date(FUTURE_DATE),
      } as unknown as Awaited<ReturnType<typeof db.giftCard.update>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: `/api/gift-cards/gc-crowd-1/close?restaurantId=${RESTAURANT_ID}`,
        headers: { ...AUTH },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('SINGLE');
      expect(body.amount).toBe(76);
      expect(body.sokarCommissionAmount).toBe(4);
      expect(body.status).toBe('ACTIVE');
      expect(db.giftCard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'gc-crowd-1' },
          data: expect.objectContaining({
            type: 'SINGLE',
            status: 'ACTIVE',
            sokarCommissionAmount: d(4),
          }),
        }),
      );
    });
  });

  // ─── Rate limiting ───────────────────────────────────────────────
  describe('rate limiting', () => {
    it('retourne 429 quand la limite est dépassée sur /payment-intent', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue(false);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/payment-intent',
        headers: { 'content-type': 'application/json' },
        payload: {
          restaurantId: RESTAURANT_ID,
          amount: 50,
        },
      });

      expect(res.statusCode).toBe(429);
      expect(res.json().error).toMatch(/Trop de requêtes/);

      // Restaurer le mock pour les autres tests
      vi.mocked(checkRateLimit).mockResolvedValue(true);
    });

    it('retourne 429 quand la limite est dépassée sur crowdfunding/:code/payment-intent', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue(false);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/crowdfunding/test-code/payment-intent',
        headers: { 'content-type': 'application/json' },
        payload: {
          amount: 20,
          contributorName: 'Paul',
          isPublicName: true,
        },
      });

      expect(res.statusCode).toBe(429);

      // Restaurer le mock pour les autres tests
      vi.mocked(checkRateLimit).mockResolvedValue(true);
    });
  });

  // ─── shortCode ───────────────────────────────────────────────────
  describe('shortCode', () => {
    it('GET /public/gift-cards/:shortCode/pdf fonctionne avec un shortCode', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-sc-1',
        restaurantId: RESTAURANT_ID,
        code: 'uuid-1234',
        shortCode: 'SKR-TEST-01',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        currency: 'EUR',
        validityMonths: 12,
        purchasedAt: new Date(),
        expiresAt: null,
        packId: null,
        preferredDate: null,
        preferredTime: null,
        preferredPartySize: null,
        senderName: 'Bob',
        senderEmail: 'bob@example.com',
        senderPhone: null,
        recipientName: 'Alice',
        recipientEmail: 'alice@example.com',
        recipientPhone: null,
        message: null,
        occasion: null,
        customerId: null,
        createdBy: 'CLIENT',
        purchaseReference: null,
        stripePaymentIntentId: null,
        stripePaymentStatus: 'succeeded',
        templateId: null,
        customImageUrl: null,
        sokarCommissionAmount: d(5),
        type: 'SINGLE',
        targetAmount: null,
        crowdfundedUntil: null,
        closedAt: null,
        restaurant: { name: 'Test Resto' },
        pack: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/public/gift-cards/SKR-TEST-01/pdf',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      // Vérifier que findUnique a été appelé avec shortCode
      expect(db.giftCard.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shortCode: 'SKR-TEST-01' },
        }),
      );
    });

    it('POST /public/gift-cards/check fonctionne avec un shortCode', async () => {
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-sc-1',
        restaurantId: RESTAURANT_ID,
        code: 'uuid-1234',
        shortCode: 'SKR-TEST-01',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        expiresAt: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        name: 'Test Resto',
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);

      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/public/gift-cards/check',
        headers: { 'content-type': 'application/json' },
        payload: { code: 'SKR-TEST-01' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(true);
      expect(body.giftCard.amount).toBe(100);
    });

    it('serializeGiftCard inclut shortCode', async () => {
      vi.mocked(db.giftCard.findMany).mockResolvedValue([
        {
          id: 'gc-1',
          restaurantId: RESTAURANT_ID,
          code: 'abc-1234-5678-9012',
          shortCode: 'SKR-X7F2-9K',
          amount: d(100),
          remainingAmount: d(100),
          currency: 'EUR',
          status: 'ACTIVE',
          createdBy: 'DASHBOARD',
          purchaseReference: 'manual',
          redemptions: [],
        } as unknown as Awaited<ReturnType<typeof db.giftCard.findMany>>[number],
      ]);
      vi.mocked(db.giftCard.count).mockResolvedValue(1);

      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/restaurants/${RESTAURANT_ID}/gift-cards`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items[0].shortCode).toBe('SKR-X7F2-9K');
    });
  });
});
