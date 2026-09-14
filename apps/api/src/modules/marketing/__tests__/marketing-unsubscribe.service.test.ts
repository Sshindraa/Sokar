import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingPermissionStatus } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  buildMarketingUnsubscribeUrl,
  consumeMarketingUnsubscribeToken,
  createMarketingUnsubscribeToken,
} from '../marketing-unsubscribe.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    marketingPermission: { upsert: vi.fn() },
    marketingPermissionEvent: { create: vi.fn() },
    customerTimelineEvent: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

describe('marketing unsubscribe token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETING_UNSUBSCRIBE_SECRET = 'u'.repeat(48);
    process.env.MARKETING_UNSUBSCRIBE_BASE_URL = 'https://api.sokar.test/marketing/unsubscribe';
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'restaurant-1' } as never);
    vi.mocked(db.customerTimelineEvent.create).mockResolvedValue({ id: 'timeline-1' } as never);
    vi.mocked(db.marketingPermission.upsert).mockResolvedValue({
      id: 'permission-1',
      status: MarketingPermissionStatus.OPTED_OUT,
      channel: 'EMAIL',
    } as never);
  });

  it('produit un lien opaque signé et refuse une altération', async () => {
    const token = await createMarketingUnsubscribeToken({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      channel: 'EMAIL',
      issuedAt: new Date('2026-09-13T12:00:00.000Z'),
      expiresAt: new Date('2026-10-13T12:00:00.000Z'),
    });
    expect(token).toMatch(/^v1\./);
    expect(buildMarketingUnsubscribeUrl(token)).toContain('token=v1.');
    await expect(
      consumeMarketingUnsubscribeToken({
        token: `${token}x`,
        now: new Date('2026-09-13T12:00:00.000Z'),
      }),
    ).rejects.toThrow('INVALID_UNSUBSCRIBE_TOKEN');
  });

  it('retire immédiatement le canal et journalise la preuve', async () => {
    const token = await createMarketingUnsubscribeToken({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      channel: 'EMAIL',
      issuedAt: new Date('2026-09-13T12:00:00.000Z'),
      expiresAt: new Date('2026-10-13T12:00:00.000Z'),
    });
    const result = await consumeMarketingUnsubscribeToken({
      token,
      now: new Date('2026-09-13T13:00:00.000Z'),
    });
    expect(result).toMatchObject({
      customerId: 'customer-1',
      restaurantId: 'restaurant-1',
      channel: 'EMAIL',
    });
    expect(db.marketingPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId_channel: { customerId: 'customer-1', channel: 'EMAIL' } },
        create: expect.objectContaining({ status: MarketingPermissionStatus.OPTED_OUT }),
      }),
    );
  });
});
