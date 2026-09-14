import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingCampaignStatus } from '@prisma/client';
import {
  LEGACY_REACTIVATION_BODY_TEMPLATE,
  migrateLegacyReactivationCampaign,
} from '../legacy-reactivation.service';
import { db } from '../../../shared/db/client';

vi.mock('../../../shared/db/client', () => {
  const db = {
    reactivationCampaign: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    customer: { findMany: vi.fn() },
    marketingCampaign: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    campaignAudienceMember: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    campaignMessage: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  return { db };
});

const RESTAURANT_ID = 'restaurant-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function pendingLegacy() {
  return {
    id: 'legacy-1',
    status: 'PENDING',
    customerIds: ['customer-1', 'customer-1', 'customer-missing'],
    marketingCampaignId: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
  };
}

function readyCampaign() {
  return {
    id: 'legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05',
    restaurantId: RESTAURANT_ID,
    name: 'Réactivation VIP historique — 2026-09-01',
    objective: 'LEGACY_REACTIVATION',
    channel: 'SMS',
    segmentId: null,
    status: MarketingCampaignStatus.READY,
    subject: null,
    bodyTemplate: LEGACY_REACTIVATION_BODY_TEMPLATE,
    scheduledAt: null,
    timezone: 'Europe/Paris',
    audienceVersion: 1,
    audienceCount: 1,
  };
}

describe('legacy reactivation migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { id: 'audience-1', customerId: 'customer-1' },
    ] as never);
    vi.mocked(db.campaignMessage.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.reactivationCampaign.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it('crée un snapshot MarketingCampaign idempotent et filtre les clients hors tenant/archivés', async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue(pendingLegacy() as never);
    vi.mocked(db.customer.findMany).mockResolvedValue([{ id: 'customer-1', isVip: true }] as never);
    vi.mocked(db.marketingCampaign.create).mockResolvedValue(readyCampaign() as never);

    const result = await migrateLegacyReactivationCampaign({
      restaurantId: RESTAURANT_ID,
      reactivationCampaignId: 'legacy-1',
      actor: 'user-1',
      now: NOW,
    });

    expect(result).toMatchObject({
      reactivationCampaignId: 'legacy-1',
      marketingCampaignId: 'legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05',
      sourceCustomerCount: 2,
      audienceCount: 1,
      droppedCustomerCount: 1,
      replayed: false,
    });
    expect(db.customer.findMany).toHaveBeenCalledWith({
      where: {
        restaurantId: RESTAURANT_ID,
        id: { in: ['customer-1', 'customer-missing'] },
        archivedAt: null,
        mergedIntoId: null,
      },
      select: { id: true, isVip: true },
    });
    expect(db.marketingCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05',
          status: MarketingCampaignStatus.READY,
          channel: 'SMS',
          bodyTemplate: LEGACY_REACTIVATION_BODY_TEMPLATE,
          audienceCount: 1,
        }),
      }),
    );
    expect(db.campaignAudienceMember.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          campaignId: 'legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05',
          customerId: 'customer-1',
          inclusionReason: 'LEGACY_REACTIVATION_SNAPSHOT',
          capturedAt: NOW,
        }),
      ],
    });
    expect(db.campaignMessage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          campaignId: 'legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05',
          customerId: 'customer-1',
          channel: 'SMS',
          idempotencyKey:
            'marketing:legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05:customer-1',
        }),
      ],
      skipDuplicates: true,
    });
    expect(db.reactivationCampaign.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'legacy-1',
        restaurantId: RESTAURANT_ID,
        status: 'PENDING',
        marketingCampaignId: null,
      },
      data: {
        status: 'MIGRATED',
        marketingCampaignId: 'legacy-reactivation-c47c02d160c6362f9b79ffa971c9fd05',
      },
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('rejoue la campagne liée sans créer de doublon', async () => {
    const linked = { ...readyCampaign(), status: MarketingCampaignStatus.SENDING };
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue({
      ...pendingLegacy(),
      marketingCampaignId: linked.id,
    } as never);
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue(linked as never);

    const result = await migrateLegacyReactivationCampaign({
      restaurantId: RESTAURANT_ID,
      reactivationCampaignId: 'legacy-1',
      now: NOW,
    });

    expect(result.replayed).toBe(true);
    expect(result.marketingCampaignId).toBe(linked.id);
    expect(db.marketingCampaign.create).not.toHaveBeenCalled();
    expect(db.customer.findMany).not.toHaveBeenCalled();
    expect(db.reactivationCampaign.updateMany).not.toHaveBeenCalled();
  });

  it('matérialise une campagne annulée si tous les clients du snapshot sont inactifs', async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue(pendingLegacy() as never);
    vi.mocked(db.customer.findMany).mockResolvedValue([] as never);
    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      ...readyCampaign(),
      status: MarketingCampaignStatus.CANCELLED,
      audienceCount: 0,
    } as never);

    const result = await migrateLegacyReactivationCampaign({
      restaurantId: RESTAURANT_ID,
      reactivationCampaignId: 'legacy-1',
      now: NOW,
    });

    expect(result.campaign.status).toBe(MarketingCampaignStatus.CANCELLED);
    expect(result.audienceCount).toBe(0);
    expect(db.campaignAudienceMember.createMany).not.toHaveBeenCalled();
    expect(db.campaignMessage.createMany).not.toHaveBeenCalled();
  });
});
