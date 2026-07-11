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
      amount: d(100),
      remainingAmount: d(100),
      currency: 'EUR',
      stripePaymentIntentId: null,
      redemptions: [],
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
    // Mock aggregate : retourne different selon le champ demandé
    vi.mocked(db.giftCard.aggregate).mockImplementation((args: any) => {
      if (args._sum?.amount) {
        return Promise.resolve({ _sum: { amount: d(230) } }) as any;
      }
      if (args._sum?.remainingAmount) {
        return Promise.resolve({ _sum: { remainingAmount: d(80) } }) as any;
      }
      return Promise.resolve({ _sum: null }) as any;
    });
    // Mock count : retourne different selon le where
    vi.mocked(db.giftCard.count).mockImplementation((args: any) => {
      if (args?.where?.status === 'REDEEMED') return Promise.resolve(1) as any;
      if (args?.where?.status === 'ACTIVE') return Promise.resolve(2) as any;
      if (args?.where?.packId) return Promise.resolve(1) as any;
      return Promise.resolve(3) as any;
    });

    const stats = await service.getStats(RESTAURANT_ID);

    expect(stats.totalSoldAmount).toBe(230);
    expect(stats.totalRemainingAmount).toBe(80);
    expect(stats.redeemedCount).toBe(1);
    expect(stats.activeCount).toBe(2);
    expect(stats.totalCount).toBe(3);
    expect(stats.averageAmount).toBe(230 / 3);
    expect(stats.packCount).toBe(1);
    expect(stats.freeAmountCount).toBe(2);
  });

  it('crée une carte à partir d un pack', async () => {
    vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
      id: 'pack-1',
      restaurantId: RESTAURANT_ID,
      amount: d(120),
    } as any);
    vi.mocked(db.giftCard.create).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(120),
      remainingAmount: d(120),
      status: 'ACTIVE',
      code: 'code-1',
      packId: 'pack-1',
    } as any);

    const card = await service.create({
      restaurantId: RESTAURANT_ID,
      packId: 'pack-1',
      createdBy: 'DASHBOARD',
    });

    expect(card.amount.toNumber()).toBe(120);
    expect(card.packId).toBe('pack-1');
  });

  // ─── shortCode ───────────────────────────────────────────────────
  it('génère un shortCode à la création', async () => {
    vi.mocked(db.giftCard.create).mockResolvedValue({
      id: 'gc-sc-1',
      restaurantId: RESTAURANT_ID,
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      code: 'uuid-1234',
      shortCode: 'SKR-TEST-01',
    } as any);

    const card = await service.create(makeCardInput());

    expect(card.shortCode).toBe('SKR-TEST-01');
    expect(db.giftCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shortCode: expect.any(String),
        }),
      }),
    );
  });

  it('findByShortCode retourne la carte correspondante', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-sc-1',
      restaurantId: RESTAURANT_ID,
      code: 'uuid-1234',
      shortCode: 'SKR-TEST-01',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
    } as any);

    const card = await service.findByShortCode('SKR-TEST-01');
    expect(card).not.toBeNull();
    expect(card?.shortCode).toBe('SKR-TEST-01');
    expect(db.giftCard.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shortCode: 'SKR-TEST-01' },
      }),
    );
  });

  it('validateCode accepte un shortCode (SKR-...)', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-sc-1',
      restaurantId: RESTAURANT_ID,
      code: 'uuid-1234',
      shortCode: 'SKR-TEST-01',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      expiresAt: null,
    } as any);

    const result = await service.validateCode('SKR-TEST-01');
    expect(result.valid).toBe(true);
    // Vérifier que findUnique a été appelé avec shortCode
    expect(db.giftCard.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shortCode: 'SKR-TEST-01' },
      }),
    );
  });

  it('findByCodeOrShortCodeWithPack accepte un shortCode', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-sc-1',
      restaurantId: RESTAURANT_ID,
      code: 'uuid-1234',
      shortCode: 'SKR-TEST-01',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      pack: null,
    } as any);

    const card = await service.findByCodeOrShortCodeWithPack('SKR-TEST-01');
    expect(card).not.toBeNull();
    expect(card?.shortCode).toBe('SKR-TEST-01');
  });
});
