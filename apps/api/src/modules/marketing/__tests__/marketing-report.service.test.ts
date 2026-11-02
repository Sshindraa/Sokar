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
    reservation: { findMany: vi.fn() },
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

  it('compare les couverts du service visé entre destinataires et témoin, par client', async () => {
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValueOnce({
      id: 'campaign-1',
      name: 'Midi calme',
      channel: 'SMS',
      status: 'SENT',
      audienceCount: 1,
      createdAt: new Date('2026-10-30T10:00:00.000Z'),
      completedAt: new Date('2026-10-30T10:05:00.000Z'),
      startedAt: new Date('2026-10-30T10:01:00.000Z'),
      targetServiceStart: new Date('2026-11-04T11:00:00.000Z'),
      targetServiceEnd: new Date('2026-11-04T15:00:00.000Z'),
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce([
      { customerId: 'customer-1', inclusionReason: 'CHANNEL_OPT_IN' },
      { customerId: 'customer-2', inclusionReason: 'HOLDOUT' },
    ] as never);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      { customerId: 'customer-1', partySize: 4 },
      { customerId: 'customer-2', partySize: 2 },
    ] as never);

    const report = await getMarketingCampaignReport({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });

    expect(report.serviceFill).toEqual({
      service: {
        start: new Date('2026-11-04T11:00:00.000Z'),
        end: new Date('2026-11-04T15:00:00.000Z'),
      },
      treated: { customers: 1, covers: 4, coversPerCustomer: 4, reservedCustomers: 1 },
      holdout: { customers: 1, covers: 2, coversPerCustomer: 2, reservedCustomers: 1 },
      difference: 2,
      conclusive: false,
      truncated: false,
      effect: { difference: 0, margin95: 0 },
      byTier: {},
      netEffect30d: null,
    });
  });

  it('n’ajoute pas de mesure de service à une campagne sans service visé', async () => {
    const report = await getMarketingCampaignReport({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
    });

    expect(report).not.toHaveProperty('serviceFill');
    expect(db.reservation.findMany).not.toHaveBeenCalled();
  });

  describe('mesure de l’effet', () => {
    const START = new Date('2026-10-01T10:00:00.000Z');

    function mockCampaign(extra: Record<string, unknown> = {}) {
      vi.mocked(db.marketingCampaign.findFirst).mockResolvedValueOnce({
        id: 'campaign-1',
        name: 'Midi calme',
        channel: 'SMS',
        status: 'SENT',
        audienceCount: 1,
        createdAt: new Date('2026-10-01T09:00:00.000Z'),
        completedAt: new Date('2026-10-01T10:05:00.000Z'),
        startedAt: START,
        targetServiceStart: new Date('2026-10-04T11:00:00.000Z'),
        targetServiceEnd: new Date('2026-10-04T15:00:00.000Z'),
        lastErrorCode: null,
        ...extra,
      } as never);
    }

    function members(treated: number, holdout: number, snapshot: unknown = {}) {
      return [
        ...Array.from({ length: treated }, (_, i) => ({
          customerId: `t${i}`,
          inclusionReason: 'CHANNEL_OPT_IN',
          snapshot,
        })),
        ...Array.from({ length: holdout }, (_, i) => ({
          customerId: `h${i}`,
          inclusionReason: 'HOLDOUT',
          snapshot,
        })),
      ] as never;
    }

    async function report() {
      return (
        await getMarketingCampaignReport({ restaurantId: 'restaurant-1', campaignId: 'campaign-1' })
      ).serviceFill!;
    }

    it('marge d’erreur, cas calculé à la main', async () => {
      mockCampaign();
      vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(180, 20));
      vi.mocked(db.reservation.findMany).mockResolvedValueOnce([
        ...Array.from({ length: 18 }, (_, i) => ({ customerId: `t${i}`, partySize: 2 })),
        { customerId: 'h0', partySize: 2 },
      ] as never);

      const fill = await report();

      expect(fill.treated.reservedCustomers).toBe(18);
      expect(fill.holdout.reservedCustomers).toBe(1);
      expect(fill.effect).toEqual({ difference: 5, margin95: 10.5 });
    });

    it('groupe vide → effect null', async () => {
      mockCampaign();
      vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(3, 0));
      vi.mocked(db.reservation.findMany).mockResolvedValueOnce([]);

      expect((await report()).effect).toBeNull();
    });

    it('un client avec deux réservations compte une fois dans reservedCustomers', async () => {
      mockCampaign();
      vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(2, 1));
      vi.mocked(db.reservation.findMany).mockResolvedValueOnce([
        { customerId: 't0', partySize: 2 },
        { customerId: 't0', partySize: 3 },
      ] as never);

      const fill = await report();

      expect(fill.treated.reservedCustomers).toBe(1);
      expect(fill.treated.covers).toBe(5);
    });

    it('byTier : sépare destinataires et témoin ; un membre ancien sans tier n’y figure pas', async () => {
      mockCampaign();
      vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce([
        { customerId: 't0', inclusionReason: 'CHANNEL_OPT_IN', snapshot: { tier: 'CRENEAU' } },
        { customerId: 't1', inclusionReason: 'CHANNEL_OPT_IN', snapshot: { tier: 'CRENEAU' } },
        { customerId: 'h0', inclusionReason: 'HOLDOUT', snapshot: { tier: 'CRENEAU' } },
        { customerId: 't2', inclusionReason: 'CHANNEL_OPT_IN', snapshot: { tier: 'CONNU' } },
        { customerId: 'old', inclusionReason: 'CHANNEL_OPT_IN', snapshot: {} },
        { customerId: 'bad', inclusionReason: 'CHANNEL_OPT_IN', snapshot: { tier: 'constructor' } },
        { customerId: 'nul', inclusionReason: 'HOLDOUT', snapshot: null },
      ] as never);
      vi.mocked(db.reservation.findMany).mockResolvedValueOnce([
        { customerId: 't0', partySize: 2 },
        { customerId: 'old', partySize: 2 },
      ] as never);

      const fill = await report();

      expect(fill.byTier).toEqual({
        CRENEAU: {
          treated: { customers: 2, reservedCustomers: 1 },
          holdout: { customers: 1, reservedCustomers: 0 },
        },
        CONNU: {
          treated: { customers: 1, reservedCustomers: 0 },
          holdout: { customers: 0, reservedCustomers: 0 },
        },
      });
      expect(fill.treated.customers).toBe(5);
      expect(fill.treated.reservedCustomers).toBe(2);
    });

    it('netEffect30d null avant 30 jours, sans requête ; calculé après, tous services confondus', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
        mockCampaign();
        vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(2, 2));
        vi.mocked(db.reservation.findMany).mockResolvedValueOnce([]);
        expect((await report()).netEffect30d).toBeNull();
        expect(db.reservation.findMany).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
        mockCampaign();
        vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(2, 2));
        vi.mocked(db.reservation.findMany)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { customerId: 't0', partySize: 4 },
            { customerId: 't0', partySize: 2 },
            { customerId: 't1', partySize: 2 },
            { customerId: 'h0', partySize: 2 },
          ] as never);

        const fill = await report();

        expect(fill.netEffect30d).toEqual({
          treatedCoversPerCustomer: 4,
          holdoutCoversPerCustomer: 1,
          difference: 3,
        });
        const query = vi.mocked(db.reservation.findMany).mock.calls[1]![0] as {
          where: { reservedAt: { gte: Date; lt: Date }; createdAt: { gte: Date } };
        };
        expect(query.where.reservedAt).toEqual({
          gte: START,
          lt: new Date('2026-10-31T10:00:00.000Z'),
        });
        expect(query.where.createdAt).toEqual({ gte: START });
      } finally {
        vi.useRealTimers();
      }
    });

    it('brouillon jamais envoyé : effect null, pas « entre 0 et 0 points »', async () => {
      mockCampaign({ startedAt: null });
      vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(30, 25));

      const fill = await report();

      expect(fill.effect).toBeNull();
      expect(fill.netEffect30d).toBeNull();
    });

    it('campagne tronquée : netEffect30d null même après 30 jours, sans requête', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
        mockCampaign({ lastErrorCode: 'TARGET_SERVICE_FULL' });
        vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(30, 25));
        vi.mocked(db.reservation.findMany).mockResolvedValueOnce([]);

        const fill = await report();

        expect(fill.netEffect30d).toBeNull();
        expect(db.reservation.findMany).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('campagne avec lastErrorCode TARGET_SERVICE_FULL : truncated vrai, conclusive faux', async () => {
      mockCampaign({ lastErrorCode: 'TARGET_SERVICE_FULL' });
      vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValueOnce(members(30, 25));
      vi.mocked(db.reservation.findMany).mockResolvedValueOnce([]);

      const fill = await report();

      expect(fill.truncated).toBe(true);
      expect(fill.conclusive).toBe(false);
    });
  });
});
