import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingCampaignStatus, MarketingPermissionStatus, Prisma } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  cancelMarketingCampaign,
  createMarketingCampaign,
  prepareMarketingCampaign,
  previewMarketingAudience,
  previewMarketingCampaign,
  updateMarketingCampaign,
} from '../marketing-campaign.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { findMany: vi.fn(), findFirst: vi.fn() },
    restaurant: { findUnique: vi.fn() },
    customerSegment: { findFirst: vi.fn() },
    customerConsent: { findMany: vi.fn() },
    marketingPermission: { findMany: vi.fn() },
    marketingSuppression: { findMany: vi.fn() },
    marketingFrequencyWindow: { findMany: vi.fn() },
    usageTariff: { findFirst: vi.fn() },
    marketingCampaign: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    campaignAudienceMember: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  },
}));

const DEFINITION = {
  version: 1 as const,
  operator: 'AND' as const,
  conditions: [{ field: 'isVip' as const, op: 'EQ' as const, value: true }],
};

describe('marketing campaign control plane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.customerSegment.findFirst).mockResolvedValue({
      id: 'segment-1',
      definition: DEFINITION,
    } as never);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'c1',
        name: 'Alice',
        isVip: true,
        phone: '+33601020304',
        emailNormalized: 'a@example.test',
      },
      { id: 'c2', name: 'Bob', isVip: true, phone: '+33601020305', emailNormalized: null },
      {
        id: 'c3',
        name: 'Claire',
        isVip: true,
        phone: '+33601020306',
        emailNormalized: 'c@example.test',
      },
      {
        id: 'c4',
        name: 'Dan',
        isVip: true,
        phone: '+33601020307',
        emailNormalized: 'd@example.test',
      },
    ] as never);
    vi.mocked(db.marketingPermission.findMany).mockResolvedValue([
      { customerId: 'c1', status: MarketingPermissionStatus.OPTED_IN, source: 'WEB' },
      { customerId: 'c3', status: MarketingPermissionStatus.OPTED_OUT, source: 'UNSUBSCRIBE' },
    ] as never);
    vi.mocked(db.marketingSuppression.findMany).mockResolvedValue([
      { customerId: 'c4', channel: null, reason: 'BOUNCE' },
    ] as never);
    vi.mocked(db.marketingFrequencyWindow.findMany).mockResolvedValue([
      { customerId: 'c2', sendCount: 3 },
    ] as never);
    vi.mocked(db.customerConsent.findMany).mockResolvedValue([]);
    vi.mocked(db.usageTariff.findFirst).mockResolvedValue(null);
  });

  it('returns an explainable, consented audience and exclusion reasons', async () => {
    const preview = await previewMarketingAudience({
      restaurantId: 'restaurant-1',
      channel: 'SMS',
      segmentId: 'segment-1',
      now: new Date('2026-09-13T12:00:00.000Z'),
    });

    expect(preview).toMatchObject({
      candidateCount: 4,
      eligibleCount: 1,
      excludedByReason: { 'SUPPRESSED:BOUNCE': 1, FREQUENCY_CAP: 1, OPTED_OUT: 1 },
      sample: [{ id: 'c1', inclusionReason: 'CHANNEL_OPT_IN' }],
    });
    expect(JSON.stringify(preview)).not.toContain('+336');
    expect(db.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ restaurantId: 'restaurant-1' }) }),
    );
  });

  it('creates a draft and stores an immutable audience snapshot in one transaction', async () => {
    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.DRAFT,
      audienceCount: 1,
    } as never);
    const campaign = await createMarketingCampaign({
      restaurantId: 'restaurant-1',
      name: 'Relance VIP',
      objective: 'Remplir le déjeuner',
      channel: 'SMS',
      segmentId: 'segment-1',
      bodyTemplate:
        'Bonjour {{customer.firstName}}, réservez ici {{reservationLink}} — {{unsubscribeUrl}}',
      createdBy: 'user-1',
    });

    expect(campaign.id).toBe('campaign-1');
    expect(db.marketingCampaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        restaurantId: 'restaurant-1',
        status: MarketingCampaignStatus.DRAFT,
        audienceCount: 1,
        createdByHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(db.campaignAudienceMember.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ campaignId: 'campaign-1', customerId: 'c1' })],
    });
  });

  it('requires an unsubscribe variable and prevents preparation of an empty draft', async () => {
    await expect(
      createMarketingCampaign({
        restaurantId: 'restaurant-1',
        name: 'Sans lien',
        objective: 'Test',
        channel: 'SMS',
        segmentId: 'segment-1',
        bodyTemplate: 'Bonjour',
      }),
    ).rejects.toThrow('must include {{unsubscribeUrl}}');

    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-empty',
      status: MarketingCampaignStatus.DRAFT,
      audienceCount: 0,
    } as never);
    await expect(
      prepareMarketingCampaign({ restaurantId: 'restaurant-1', campaignId: 'campaign-empty' }),
    ).rejects.toThrow('AUDIENCE_EMPTY');
  });

  it('renders a campaign from its immutable snapshot and reports billable units', async () => {
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      name: 'Relance déjeuner',
      objective: 'Remplir le service',
      channel: 'SMS',
      status: MarketingCampaignStatus.DRAFT,
      subject: null,
      bodyTemplate:
        'Bonjour {{customer.firstName}}, réservez chez {{restaurant.name}} {{reservationLink}} {{unsubscribeUrl}}',
      scheduledAt: null,
      timezone: 'Europe/Paris',
      audienceCount: 3,
      restaurant: { name: 'Chez Sokar' },
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { customerId: 'customer-1' },
    ] as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ name: 'Alice Martin' } as never);

    const preview = await previewMarketingCampaign({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });

    expect(preview).toMatchObject({
      campaign: { id: 'campaign-1', status: MarketingCampaignStatus.DRAFT },
      audience: { captured: 3, eligible: 3, sampleCustomer: 'Alice Martin' },
      render: { body: expect.stringContaining('Bonjour Alice'), usedFallbackCustomer: false },
      usage: {
        category: 'SMS_SEGMENTS',
        unitsPerMessage: 1,
        totalUnits: 3,
        encoding: 'gsm7',
      },
      costEstimate: { amount: null, status: 'NOT_AVAILABLE' },
    });
    expect(JSON.stringify(preview)).not.toContain('customer-1');
  });

  it('calcule le coût du preview avec le tarif fournisseur versionné', async () => {
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      name: 'Relance déjeuner',
      objective: 'Remplir le service',
      channel: 'SMS',
      status: MarketingCampaignStatus.DRAFT,
      subject: null,
      bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      scheduledAt: new Date('2026-09-20T12:00:00.000Z'),
      timezone: 'Europe/Paris',
      audienceCount: 3,
      restaurant: { name: 'Chez Sokar' },
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { customerId: 'customer-1' },
    ] as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ name: 'Alice Martin' } as never);
    vi.mocked(db.usageTariff.findFirst).mockResolvedValue({
      id: 'tariff-telnyx-sms',
      category: 'SMS_SEGMENTS',
      provider: 'telnyx',
      unit: 'segments',
      pricePerUnit: new Prisma.Decimal('0.0075'),
      currency: 'EUR',
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      effectiveTo: null,
      version: 1,
      source: 'invoice:telnyx:2026-09',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    } as never);

    const preview = await previewMarketingCampaign({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });

    expect(preview.costEstimate).toEqual({
      amount: '0.022500',
      currency: 'EUR',
      status: 'PRICED',
      reason: 'PROVIDER_TARIFF_RECONCILED',
      tariffId: 'tariff-telnyx-sms',
      pricePerUnit: '0.007500000',
    });
    expect(db.usageTariff.findFirst).toHaveBeenCalledWith({
      where: {
        category: 'SMS_SEGMENTS',
        provider: 'telnyx',
        unit: 'segments',
        currency: 'EUR',
        effectiveFrom: { lte: new Date('2026-09-20T12:00:00.000Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date('2026-09-20T12:00:00.000Z') } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
  });

  it('updates draft copy while keeping the audience snapshot stable', async () => {
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      restaurantId: 'restaurant-1',
      name: 'Ancien nom',
      objective: 'Ancien objectif',
      channel: 'SMS',
      status: MarketingCampaignStatus.DRAFT,
      subject: null,
      bodyTemplate: 'Ancien {{unsubscribeUrl}}',
      scheduledAt: null,
      timezone: 'Europe/Paris',
      audienceVersion: 1,
      audienceCount: 4,
      segmentId: 'segment-1',
    } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      name: 'Nouveau nom',
      bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      status: MarketingCampaignStatus.DRAFT,
    } as never);

    const updated = await updateMarketingCampaign({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
      changes: {
        name: 'Nouveau nom',
        bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      },
    });

    expect(updated).toMatchObject({ id: 'campaign-1', name: 'Nouveau nom' });
    expect(db.campaignAudienceMember.deleteMany).not.toHaveBeenCalled();
    expect(db.marketingCampaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: expect.objectContaining({
        name: 'Nouveau nom',
        bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      }),
    });
  });

  it('refuses de changer le canal d’une campagne READY dont le snapshot est figé', async () => {
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-ready',
      restaurantId: 'restaurant-1',
      name: 'Prête',
      objective: 'Test',
      channel: 'SMS',
      status: MarketingCampaignStatus.READY,
      subject: null,
      bodyTemplate: 'Bonjour {{unsubscribeUrl}}',
      scheduledAt: null,
      timezone: 'Europe/Paris',
      audienceVersion: 1,
      audienceCount: 1,
      segmentId: 'segment-1',
    } as never);

    await expect(
      updateMarketingCampaign({
        restaurantId: 'restaurant-1',
        campaignId: 'campaign-ready',
        changes: { channel: 'EMAIL', subject: 'Objet' },
      }),
    ).rejects.toThrow('CAMPAIGN_AUDIENCE_FROZEN');
    expect(db.marketingCampaign.update).not.toHaveBeenCalled();
  });

  it('keeps tenant scope and only cancels cancellable campaigns', async () => {
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.READY,
      audienceCount: 1,
    } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.CANCELLED,
    } as never);
    await expect(
      cancelMarketingCampaign({ restaurantId: 'restaurant-1', campaignId: 'campaign-1' }),
    ).resolves.toMatchObject({ status: MarketingCampaignStatus.CANCELLED });
    expect(db.marketingCampaign.findFirst).toHaveBeenCalledWith({
      where: { id: 'campaign-1', restaurantId: 'restaurant-1' },
    });
  });
});
