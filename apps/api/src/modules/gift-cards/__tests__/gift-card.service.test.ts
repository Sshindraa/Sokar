import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import '../../../test/helpers.js';
import { db } from '../../../shared/db/client.js';
import { GiftCardService, GiftCardError } from '../gift-card.service.js';

const RESTAURANT_ID = 'rest-gift-1';

function d(value: number) {
  return new Prisma.Decimal(value);
}

function makeCardInput(overrides: Partial<Parameters<typeof service.create>[0]> = {}) {
  return {
    restaurantId: RESTAURANT_ID,
    amount: 100,
    recipientName: 'Alice',
    recipientEmail: 'alice@example.com',
    senderName: 'Bob',
    occasion: 'anniversaire',
    ...overrides,
  };
}

const service = new GiftCardService(db);

describe('GiftCardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crée une carte cadeau avec remainingAmount égal à amount', async () => {
    vi.mocked(db.giftCard.create).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'code-1',
    } as any);

    const card = await service.create(makeCardInput());

    expect(card.remainingAmount.toNumber()).toBe(100);
    expect(card.status).toBe('ACTIVE');
    expect(db.giftCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          amount: expect.anything(),
          remainingAmount: expect.anything(),
        }),
      }),
    );
  });

  it('rejette un montant nul ou négatif', async () => {
    await expect(service.create(makeCardInput({ amount: 0 }))).rejects.toThrow(GiftCardError);
    await expect(service.create(makeCardInput({ amount: -10 }))).rejects.toThrow(GiftCardError);
  });

  it('valide un code correct', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'code-1',
      expiresAt: null,
    } as any);

    const result = await service.validateCode('code-1', RESTAURANT_ID);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.giftCard.id).toBe('gc-1');
    }
  });

  it('retourne NOT_FOUND pour un code inexistant', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue(null);

    const result = await service.validateCode('inexistant', RESTAURANT_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('NOT_FOUND');
    }
  });

  it('retourne EXPIRED pour une carte expirée', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'code-1',
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    } as any);

    const result = await service.validateCode('code-1', RESTAURANT_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('EXPIRED');
    }
  });

  it('retourne CANCELLED pour une carte annulée', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'CANCELLED',
      code: 'code-1',
      expiresAt: null,
    } as any);

    const result = await service.validateCode('code-1', RESTAURANT_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('CANCELLED');
    }
  });

  it('retourne FULLY_REDEEMED pour une carte épuisée', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(0),
      status: 'ACTIVE',
      code: 'code-1',
      expiresAt: null,
    } as any);

    const result = await service.validateCode('code-1', RESTAURANT_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('FULLY_REDEEMED');
    }
  });

  it('retourne WRONG_RESTAURANT si le restaurant ne correspond pas', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: 'autre-restaurant',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'code-1',
      expiresAt: null,
    } as any);

    const result = await service.validateCode('code-1', RESTAURANT_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('WRONG_RESTAURANT');
    }
  });

  it('applique une carte cadeau : fully covered', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'code-1',
      expiresAt: null,
    } as any);
    vi.mocked(db.giftCard.update).mockResolvedValue({
      id: 'gc-1',
      remainingAmount: d(0),
      status: 'REDEEMED',
    } as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      if (Array.isArray(fn)) {
        return Promise.all(fn);
      }
      return fn(db);
    });

    const result = await service.applyToReservation({
      code: 'code-1',
      restaurantId: RESTAURANT_ID,
      reservationId: 'res-1',
      reservationAmount: 100,
    });

    expect(result.appliedAmount).toBe(100);
    expect(result.remainingAmount).toBe(0);
    expect(result.paymentStatus).toBe('FULLY_COVERED');
    expect(result.complementAmount).toBe(0);
    expect(db.giftCardRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          giftCardId: 'gc-1',
          reservationId: 'res-1',
        }),
      }),
    );
    expect(db.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REDEEMED',
        }),
      }),
    );
  });

  it('applique une carte cadeau : partial', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'code-1',
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

    const result = await service.applyToReservation({
      code: 'code-1',
      restaurantId: RESTAURANT_ID,
      reservationId: 'res-1',
      reservationAmount: 60,
    });

    expect(result.appliedAmount).toBe(60);
    expect(result.remainingAmount).toBe(40);
    expect(result.paymentStatus).toBe('PARTIAL');
    expect(result.complementAmount).toBe(0);
  });

  it('applique une carte cadeau : complement required', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(50),
      status: 'ACTIVE',
      code: 'code-1',
      expiresAt: null,
    } as any);
    vi.mocked(db.giftCard.update).mockResolvedValue({
      id: 'gc-1',
      remainingAmount: d(0),
      status: 'REDEEMED',
    } as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      if (Array.isArray(fn)) {
        return Promise.all(fn);
      }
      return fn(db);
    });

    const result = await service.applyToReservation({
      code: 'code-1',
      restaurantId: RESTAURANT_ID,
      reservationId: 'res-1',
      reservationAmount: 120,
    });

    expect(result.appliedAmount).toBe(50);
    expect(result.remainingAmount).toBe(0);
    expect(result.paymentStatus).toBe('COMPLEMENT_REQUIRED');
    expect(result.complementAmount).toBe(70);
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
    } as any);

    const card = await service.cancel('gc-1', RESTAURANT_ID);

    expect(card.status).toBe('CANCELLED');
    expect(db.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          remainingAmount: expect.anything(),
        }),
      }),
    );
  });

  it('calcule les stats', async () => {
    vi.mocked(db.giftCard.findMany).mockResolvedValue([
      { amount: d(100), remainingAmount: d(0), status: 'REDEEMED' } as any,
      { amount: d(50), remainingAmount: d(50), status: 'ACTIVE' } as any,
      { amount: d(80), remainingAmount: d(30), status: 'ACTIVE' } as any,
    ]);

    const stats = await service.getStats(RESTAURANT_ID);

    expect(stats.totalSoldAmount).toBe(230);
    expect(stats.totalRemainingAmount).toBe(80);
    expect(stats.redeemedCount).toBe(1);
    expect(stats.activeCount).toBe(2);
    expect(stats.totalCount).toBe(3);
    expect(stats.averageAmount).toBe(230 / 3);
  });
});
