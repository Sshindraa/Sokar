import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingPermissionStatus } from '@prisma/client';
import { db } from '../../../shared/db/client';
import { marketingOptOutHash } from '../marketing-opt-out.service';
import {
  loadLegacyMarketingOptIns,
  resolveMarketingPermission,
  upsertMarketingPermission,
  withdrawMarketingPermission,
} from '../marketing-permission.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    customerConsent: { findMany: vi.fn() },
    marketingPermission: { upsert: vi.fn(), findMany: vi.fn() },
    marketingPermissionEvent: { create: vi.fn() },
    marketingOptOut: { upsert: vi.fn(), deleteMany: vi.fn() },
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
      resolveMarketingPermission({ channel: 'SMS', legacyMarketingOptIn: true }),
    ).toMatchObject({ allowed: true, source: 'LEGACY_CUSTOMER_CONSENT' });
    // A legacy flag tied to a phone number never authorises e-mail prospecting.
    expect(
      resolveMarketingPermission({ channel: 'EMAIL', legacyMarketingOptIn: true }),
    ).toMatchObject({ allowed: false, source: 'NONE', reason: 'NO_LEGACY_CONSENT' });
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

  describe('opt-out register and proof details', () => {
    const contact = {
      id: 'customer-1',
      phone: '+33601020304',
      emailNormalized: 'alice@example.com',
    };
    const optOut = () => db.marketingOptOut as unknown as Record<string, ReturnType<typeof vi.fn>>;

    beforeEach(() => {
      vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
      vi.mocked(db.customer.findFirst).mockResolvedValue(contact as never);
      vi.mocked(db.marketingPermission.upsert).mockResolvedValue({ id: 'permission-1' } as never);
      optOut().upsert.mockResolvedValue({});
      optOut().deleteMany.mockResolvedValue({ count: 0 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it('registers a withdrawal in the opt-out register under the address of the channel', async () => {
      await withdrawMarketingPermission({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        channel: 'EMAIL',
        source: 'UNSUBSCRIBE_LINK',
        occurredAt: new Date('2026-10-23T10:00:00.000Z'),
      });
      const call = optOut().upsert.mock.calls[0][0];
      expect(call.create).toMatchObject({
        restaurantId: 'restaurant-1',
        channel: 'EMAIL',
        reason: 'UNSUBSCRIBE',
        source: 'UNSUBSCRIBE_LINK',
      });
      expect(call.create.addressHash).toBe(marketingOptOutHash('EMAIL', 'alice@example.com'));

      optOut().upsert.mockClear();
      await withdrawMarketingPermission({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        channel: 'SMS',
        source: 'DASHBOARD_WITHDRAWAL',
      });
      expect(optOut().upsert.mock.calls[0][0].create).toMatchObject({
        channel: 'SMS',
        reason: 'MANUAL',
        addressHash: marketingOptOutHash('SMS', '+33601020304'),
      });
    });

    it('lifts the opposition when the person opts in again', async () => {
      await upsertMarketingPermission({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        channel: 'EMAIL',
        status: MarketingPermissionStatus.OPTED_IN,
        source: 'CONNECT',
        proofVersion: 'marketing-consent-2026-10-22',
        proof: 'texte',
      });
      expect(optOut().deleteMany).toHaveBeenCalledWith({
        where: {
          restaurantId: 'restaurant-1',
          channel: 'EMAIL',
          addressHash: marketingOptOutHash('EMAIL', 'alice@example.com'),
        },
      });
      expect(optOut().upsert).not.toHaveBeenCalled();
    });

    it('never fails the permission change when the register cannot be updated', async () => {
      optOut().upsert.mockRejectedValue(new Error('db down for alice@example.com'));
      await expect(
        withdrawMarketingPermission({
          restaurantId: 'restaurant-1',
          customerId: 'customer-1',
          channel: 'EMAIL',
        }),
      ).resolves.toMatchObject({ id: 'permission-1' });
      expect(db.marketingPermissionEvent.create).toHaveBeenCalled();
    });

    it('keeps the exact proof text and the author in the event ledger, not in the permission row', async () => {
      await upsertMarketingPermission({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        channel: 'EMAIL',
        status: MarketingPermissionStatus.OPTED_IN,
        source: 'DASHBOARD_IN_PERSON',
        proofVersion: 'marketing-consent-2026-10-22',
        proof: '  marketing-consent-2026-10-22|EMAIL|Je souhaite…|IN_PERSON  ',
        actorUserId: 'user_123',
      });
      expect(db.marketingPermissionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          proofText: 'marketing-consent-2026-10-22|EMAIL|Je souhaite…|IN_PERSON',
          actorUserId: 'user_123',
        }),
      });
      const permission = vi.mocked(db.marketingPermission.upsert).mock.calls[0][0];
      expect(permission.create).not.toHaveProperty('proofText');
      expect(permission.create).not.toHaveProperty('actorUserId');
    });
  });
});
