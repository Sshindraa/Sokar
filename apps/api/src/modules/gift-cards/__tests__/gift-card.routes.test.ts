import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
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
        } as any,
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
      } as any);

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
      } as any);
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
      } as any);

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
      vi.mocked(db.giftCard.findMany).mockResolvedValue([
        { amount: d(100), remainingAmount: d(0), status: 'REDEEMED' } as any,
        { amount: d(50), remainingAmount: d(50), status: 'ACTIVE' } as any,
      ]);

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
      } as any);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({ name: 'Chez Sokar' } as any);

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
      } as any);
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
      } as any);

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
      } as any);
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
        amount: d(150),
      } as any);
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
      } as any);
      vi.mocked(db.giftCardPack.findUnique).mockResolvedValue({
        id: 'pack-1',
        name: 'Menu dégustation',
      } as any);

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
      } as any);

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
      } as any);

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
      } as any);
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
      } as any);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        timezone: 'Europe/Paris',
      } as any);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        requireManualValidation: false,
        capacitySpecials: null,
      } as any);
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
      } as any);
      vi.mocked(db.giftCard.update).mockResolvedValue({
        id: 'gc-1',
        remainingAmount: d(40),
        status: 'ACTIVE',
      } as any);
      vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
        if (Array.isArray(fn)) {
          return Promise.all(fn);
        }
        return fn(db);
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
});
