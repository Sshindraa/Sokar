import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  getMarketingCampaignReport,
  marketingCampaignReportToCsv,
} from '../marketing-report.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    marketingCampaign: { findFirst: vi.fn() },
    campaignAudienceMember: { findMany: vi.fn() },
    campaignMessage: { findMany: vi.fn() },
    usageEvent: { findMany: vi.fn() },
    marketingAttributionLink: { findMany: vi.fn() },
    marketingConversion: { findMany: vi.fn() },
    marketingPermissionEvent: { findMany: vi.fn() },
  },
}));

describe('marketing campaign report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      name: 'Relance déjeuner',
      channel: 'SMS',
      status: 'SENT',
      audienceCount: 2,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      completedAt: new Date('2026-09-01T10:05:00.000Z'),
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { customerId: 'customer-1' },
      { customerId: 'customer-2' },
    ] as never);
    vi.mocked(db.campaignMessage.findMany).mockResolvedValue([
      { id: 'message-1', status: 'ACCEPTED' },
      { id: 'message-2', status: 'FAILED' },
      { id: 'message-3', status: 'CANCELLED' },
    ] as never);
    vi.mocked(db.usageEvent.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingAttributionLink.findMany).mockResolvedValue([
      { clickedAt: new Date('2026-09-01T10:01:00.000Z') },
      { clickedAt: null },
    ] as never);
    vi.mocked(db.marketingConversion.findMany).mockResolvedValue([
      {
        customerId: 'customer-1',
        reservationId: 'reservation-1',
        conversionType: 'RESERVATION_CREATED',
        active: true,
        reservation: { estimatedRevenue: 70, confirmedRevenue: null },
      },
      {
        customerId: 'customer-1',
        reservationId: 'reservation-1',
        conversionType: 'RESERVATION_HONORED',
        active: true,
        reservation: { estimatedRevenue: 70, confirmedRevenue: 82.5 },
      },
      {
        customerId: 'customer-2',
        conversionType: 'RESERVATION_CREATED',
        active: false,
        reservation: { estimatedRevenue: 35, confirmedRevenue: 35 },
      },
    ] as never);
    vi.mocked(db.marketingPermissionEvent.findMany).mockResolvedValue([
      { customerId: 'customer-2' },
    ] as never);
  });

  it('sépare livraison, désinscriptions, conversions et revenus', async () => {
    const report = await getMarketingCampaignReport({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });
    expect(report).toMatchObject({
      audience: { captured: 2, eligible: 2, excludedBeforeSend: 1 },
      delivery: {
        accepted: 1,
        failed: 1,
        cancelled: 1,
        clicked: 1,
        unsubscribed: 1,
      },
      attribution: {
        reservationsCreated: 1,
        visitsHonored: 1,
        activeConversions: 2,
        estimatedRevenue: 70,
        confirmedRevenue: 82.5,
      },
      cost: { amount: null, status: 'NOT_AVAILABLE' },
    });
  });

  it('produit un CSV agrégé et protège les noms contre les formules tableur', async () => {
    const report = await getMarketingCampaignReport({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });
    const csv = marketingCampaignReportToCsv({
      ...report,
      campaign: { ...report.campaign, name: '=IMPORT("https://example.test")' },
    });

    expect(csv.startsWith('\uFEFFmetric,value\n')).toBe(true);
    expect(csv).toContain('"campaign_name","\'=IMPORT(""https://example.test"")"');
    expect(csv).toContain('"estimated_revenue_eur","70"');
    expect(csv).not.toContain('customer-1');
  });

  it('rapporte le coût des messages lorsque les événements d’usage sont tarifés', async () => {
    vi.mocked(db.usageEvent.findMany).mockResolvedValue([
      { estimatedCost: new Prisma.Decimal('0.12'), metadata: { costStatus: 'PRICED' } },
      { estimatedCost: new Prisma.Decimal('0.03'), metadata: { costStatus: 'PRICED' } },
    ] as never);

    const report = await getMarketingCampaignReport({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });

    expect(report.cost).toEqual({ amount: 0.15, currency: 'EUR', status: 'PRICED' });
    expect(db.usageEvent.findMany).toHaveBeenCalledWith({
      where: {
        restaurantId: 'restaurant-1',
        sourceType: 'marketing_campaign',
        sourceId: { in: ['message-1', 'message-2', 'message-3'] },
      },
      select: { estimatedCost: true, metadata: true },
    });
  });

  it('signale un coût partiel quand un événement est encore non tarifé', async () => {
    vi.mocked(db.usageEvent.findMany).mockResolvedValue([
      { estimatedCost: new Prisma.Decimal('0.12'), metadata: { costStatus: 'PRICED' } },
      { estimatedCost: new Prisma.Decimal(0), metadata: { costStatus: 'UNPRICED' } },
    ] as never);

    const report = await getMarketingCampaignReport({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });

    expect(report.cost).toEqual({ amount: 0.12, currency: 'EUR', status: 'PARTIAL' });
  });
});
