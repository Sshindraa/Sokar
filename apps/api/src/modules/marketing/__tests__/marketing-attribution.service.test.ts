import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingConversionType } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  createMarketingAttributionLink,
  deactivateMarketingConversions,
  recordMarketingAttributionClick,
  recordMarketingConversion,
  recordMarketingHonoredConversions,
} from '../marketing-attribution.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    marketingCampaign: { findFirst: vi.fn(), update: vi.fn() },
    customer: { findFirst: vi.fn() },
    marketingAttributionLink: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    marketingConversion: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  },
}));

describe('marketing attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETING_ATTRIBUTION_SECRET = 'a'.repeat(48);
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({ id: 'campaign-1' } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
  });

  it('creates an expiring signed link whose payload carries no customer id', async () => {
    vi.mocked(db.marketingAttributionLink.upsert).mockResolvedValue({
      id: 'link-1',
      tokenHash: 'hash',
      customerId: 'customer-1',
    } as never);
    const issuedAt = new Date('2026-09-13T12:00:00.000Z');
    const result = await createMarketingAttributionLink({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      issuedAt,
      expiresAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    expect(result.token).toMatch(/^v1\.[^.]+\.[^.]+$/);
    const payload = JSON.parse(Buffer.from(result.token.split('.')[1]!, 'base64url').toString());
    expect(payload).not.toHaveProperty('customerId');
    expect(db.marketingAttributionLink.upsert).toHaveBeenCalledWith({
      where: { campaignId_customerId: { campaignId: 'campaign-1', customerId: 'customer-1' } },
      create: expect.objectContaining({ id: expect.any(String), tokenHash: expect.any(String) }),
      update: expect.objectContaining({ tokenHash: expect.any(String), clickedAt: null }),
    });
  });

  it('records a click only for the exact unexpired token and is idempotent', async () => {
    vi.mocked(db.marketingAttributionLink.upsert).mockResolvedValue({ id: 'link-1' } as never);
    const result = await createMarketingAttributionLink({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      issuedAt: new Date('2026-09-13T12:00:00.000Z'),
      expiresAt: new Date('2026-09-20T12:00:00.000Z'),
    });
    vi.mocked(db.marketingAttributionLink.findFirst).mockResolvedValue({
      id: 'link-1',
      clickedAt: null,
      customerId: 'customer-1',
    } as never);
    vi.mocked(db.marketingAttributionLink.update).mockResolvedValue({
      id: 'link-1',
      clickedAt: new Date('2026-09-14T12:00:00.000Z'),
    } as never);

    await expect(
      recordMarketingAttributionClick({
        token: result.token,
        now: new Date('2026-09-14T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ id: 'link-1' });
    await expect(
      recordMarketingAttributionClick({
        token: `${result.token}tampered`,
        now: new Date('2026-09-14T12:00:00.000Z'),
      }),
    ).rejects.toThrow('INVALID_ATTRIBUTION_TOKEN');
    expect(db.marketingAttributionLink.update).toHaveBeenCalledTimes(1);
  });

  it('creates one conversion and keeps the campaign counter idempotent', async () => {
    vi.mocked(db.marketingConversion.create).mockResolvedValue({ id: 'conversion-1' } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({ id: 'campaign-1' } as never);
    const result = await recordMarketingConversion({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      reservationId: 'reservation-1',
      conversionType: MarketingConversionType.RESERVATION_CREATED,
      attributedAt: new Date('2026-09-14T12:00:00.000Z'),
    });
    expect(result).toEqual({ conversion: { id: 'conversion-1' }, created: true });
    expect(db.marketingCampaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { conversionCount: { increment: 1 } },
    });
  });

  it('deactivates active conversions only within the tenant', async () => {
    vi.mocked(db.marketingConversion.updateMany).mockResolvedValue({ count: 2 } as never);
    await expect(
      deactivateMarketingConversions({
        restaurantId: 'restaurant-1',
        reservationId: 'reservation-1',
      }),
    ).resolves.toBe(2);
    expect(db.marketingConversion.updateMany).toHaveBeenCalledWith({
      where: {
        reservationId: 'reservation-1',
        active: true,
        campaign: { restaurantId: 'restaurant-1' },
      },
      data: { active: false },
    });
  });

  it('crée une conversion honorée idempotente pour les réservations attribuées', async () => {
    vi.mocked(db.marketingConversion.findMany).mockResolvedValue([
      {
        campaignId: 'campaign-1',
        windowEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ] as never);
    vi.mocked(db.marketingConversion.create).mockResolvedValue({ id: 'honored-1' } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({ id: 'campaign-1' } as never);

    await expect(
      recordMarketingHonoredConversions({
        restaurantId: 'restaurant-1',
        reservationId: 'reservation-1',
        customerId: 'customer-1',
        honoredAt: new Date('2026-09-15T20:00:00.000Z'),
      }),
    ).resolves.toBe(1);
    expect(db.marketingConversion.findMany).toHaveBeenCalledWith({
      where: {
        reservationId: 'reservation-1',
        customerId: 'customer-1',
        conversionType: MarketingConversionType.RESERVATION_CREATED,
        active: true,
        campaign: { restaurantId: 'restaurant-1' },
      },
      select: { campaignId: true, windowEndsAt: true },
    });
    expect(db.marketingConversion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'campaign-1',
        customerId: 'customer-1',
        reservationId: 'reservation-1',
        conversionType: MarketingConversionType.RESERVATION_HONORED,
        conversionKey: 'campaign-1:customer-1:reservation-1:RESERVATION_HONORED',
      }),
    });
  });
});
