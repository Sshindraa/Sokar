import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingPermissionStatus } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  loadLegacyMarketingOptIns,
  resolveMarketingPermission,
  upsertMarketingPermission,
} from '../marketing-permission.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    customerConsent: { findMany: vi.fn() },
    marketingPermission: { upsert: vi.fn(), findMany: vi.fn() },
    marketingPermissionEvent: { create: vi.fn() },
    customerTimelineEvent: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

describe('marketing permission projection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives channel opt-in precedence and never infers WhatsApp from legacy consent', () => {
    expect(
      resolveMarketingPermission({
        channel: 'SMS',
        channelStatus: MarketingPermissionStatus.OPTED_IN,
        legacyMarketingOptIn: false,
      }),
    ).toMatchObject({ allowed: true, source: 'CHANNEL_PERMISSION' });
    expect(
      resolveMarketingPermission({
        channel: 'SMS',
        channelStatus: MarketingPermissionStatus.OPTED_OUT,
        legacyMarketingOptIn: true,
      }),
    ).toMatchObject({ allowed: false, reason: 'OPTED_OUT' });
    expect(
      resolveMarketingPermission({ channel: 'WHATSAPP', legacyMarketingOptIn: true }),
    ).toMatchObject({ allowed: false, reason: 'NO_LEGACY_CONSENT' });
    expect(
      resolveMarketingPermission({ channel: 'EMAIL', legacyMarketingOptIn: true }),
    ).toMatchObject({ allowed: true, source: 'LEGACY_CUSTOMER_CONSENT' });
  });

  it('stores only a proof hash and appends a permission event', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'restaurant-1' } as never);
    vi.mocked(db.marketingPermission.upsert).mockResolvedValue({
      id: 'permission-1',
      customerId: 'customer-1',
      channel: 'EMAIL',
    } as never);
    const occurredAt = new Date('2026-09-13T10:00:00.000Z');

    await upsertMarketingPermission({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      channel: 'EMAIL',
      status: MarketingPermissionStatus.OPTED_IN,
      source: 'WEB_FORM',
      proofVersion: 'privacy-2026-09',
      proof: 'checkbox + version + timestamp',
      occurredAt,
    });

    const upsertCall = vi.mocked(db.marketingPermission.upsert).mock.calls[0]?.[0];
    expect(upsertCall?.create.proofHash).toMatch(/^[0-9a-f]{64}$/);
    expect(upsertCall?.create).not.toHaveProperty('proof');
    expect(db.marketingPermissionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permissionId: 'permission-1',
        status: MarketingPermissionStatus.OPTED_IN,
        proofHash: upsertCall?.create.proofHash,
        occurredAt,
      }),
    });
  });

  it('rejects an opt-in without versioned proof and scopes legacy lookup to a restaurant', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    await expect(
      upsertMarketingPermission({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        channel: 'SMS',
        status: MarketingPermissionStatus.OPTED_IN,
        source: 'MANUAL',
      }),
    ).rejects.toThrow('requires proofVersion and proof');

    vi.mocked(db.customerConsent.findMany).mockResolvedValue([{ subjectHash: 'hash-1' }] as never);
    const result = await loadLegacyMarketingOptIns({
      restaurantId: 'restaurant-1',
      customers: [{ id: 'customer-1', phone: '+33601020304' }],
    });
    expect(result).toEqual(new Set());
    expect(db.customerConsent.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ restaurantId: 'restaurant-1', marketingOptIn: true }),
      select: { subjectHash: true },
    });
  });
});
