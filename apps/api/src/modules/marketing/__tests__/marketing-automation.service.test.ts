import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MarketingAutomationDispatchStatus,
  MarketingAutomationType,
  MarketingCampaignStatus,
  MarketingPermissionStatus,
} from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  createMarketingAutomationCampaign,
  evaluateMarketingAutomation,
  findMarketingAutomationCandidates,
  parseMarketingAutomationConfig,
  upsertMarketingAutomation,
} from '../marketing-automation.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { findMany: vi.fn() },
    customerConsent: { findMany: vi.fn() },
    marketingPermission: { findMany: vi.fn() },
    marketingSuppression: { findMany: vi.fn() },
    marketingFrequencyWindow: { findMany: vi.fn() },
    marketingAutomation: { update: vi.fn(), upsert: vi.fn() },
    marketingAutomationDispatch: { create: vi.fn() },
    marketingCampaign: { create: vi.fn(), update: vi.fn() },
    campaignAudienceMember: { findMany: vi.fn(), createMany: vi.fn() },
    campaignMessage: { createMany: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  },
}));

const NOW = new Date('2026-09-13T12:00:00.000Z');
type AutomationFixture = Parameters<typeof findMarketingAutomationCandidates>[0]['automation'];
const AUTOMATION = {
  id: 'automation-1',
  restaurantId: 'restaurant-1',
  type: MarketingAutomationType.AFTER_FIRST_HONORED,
  channel: 'SMS',
  config: {
    bodyTemplate: 'Merci {{customer.firstName}} {{unsubscribeUrl}}',
    subject: null,
    timezone: 'Europe/Paris',
    delayHours: 24,
  },
  version: 2,
  enabled: true,
} as unknown as AutomationFixture;

describe('marketing automation engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.customerConsent.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingPermission.findMany).mockResolvedValue([
      { customerId: 'customer-1', status: MarketingPermissionStatus.OPTED_IN },
    ] as never);
    vi.mocked(db.marketingSuppression.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingFrequencyWindow.findMany).mockResolvedValue([]);
  });

  it('normalise un config par type et refuse un template sans désinscription', () => {
    expect(
      parseMarketingAutomationConfig('DORMANT', 'SMS', {
        bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
        inactiveDays: 120,
      }),
    ).toMatchObject({ inactiveDays: 120, timezone: 'Europe/Paris', subject: null });
    expect(() =>
      parseMarketingAutomationConfig('BIRTHDAY', 'SMS', { bodyTemplate: 'Joyeux anniversaire' }),
    ).toThrow('must include {{unsubscribeUrl}}');
  });

  it('sélectionne la première visite honorée après le délai et respecte le tenant', async () => {
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'customer-1',
        name: 'Alice',
        phone: '+33601020304',
        emailNormalized: null,
        timelineEvents: [
          {
            id: 'event-1',
            sourceId: 'reservation-1',
            occurredAt: new Date('2026-09-12T10:00:00.000Z'),
          },
        ],
      },
    ] as never);

    await expect(
      findMarketingAutomationCandidates({ automation: AUTOMATION, now: NOW }),
    ).resolves.toEqual([
      expect.objectContaining({
        customerId: 'customer-1',
        triggerKey: 'first-honored:reservation-1',
        inclusionReason: 'AUTOMATION_AFTER_FIRST_HONORED',
      }),
    ]);
    expect(db.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ restaurantId: 'restaurant-1', archivedAt: null }),
      }),
    );
  });

  it('exclut un client dormant qui a déjà une réservation future', async () => {
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'customer-1',
        name: 'Alice',
        phone: '+33601020304',
        emailNormalized: null,
        metricSnapshot: {
          lastHonoredAt: new Date('2026-05-01T12:00:00.000Z'),
          nextReservationAt: new Date('2026-09-20T12:00:00.000Z'),
        },
      },
    ] as never);
    const automation = {
      ...AUTOMATION,
      type: MarketingAutomationType.DORMANT,
      config: {
        bodyTemplate: 'On vous attend {{unsubscribeUrl}}',
        subject: null,
        timezone: 'Europe/Paris',
        inactiveDays: 90,
      },
    } as unknown as AutomationFixture;
    await expect(findMarketingAutomationCandidates({ automation, now: NOW })).resolves.toEqual([]);
  });

  it('ne crée pas une relance anniversaire avant l heure locale configurée', async () => {
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'customer-1',
        name: 'Alice',
        phone: '+33601020304',
        emailNormalized: null,
        birthMonth: 9,
        birthDay: 14,
      },
    ] as never);
    const automation = {
      ...AUTOMATION,
      type: MarketingAutomationType.BIRTHDAY,
      config: {
        bodyTemplate: 'Joyeux anniversaire {{unsubscribeUrl}}',
        subject: null,
        timezone: 'Europe/Paris',
        daysBefore: 1,
        sendHour: 13,
      },
    } as unknown as AutomationFixture;
    await expect(
      findMarketingAutomationCandidates({
        automation,
        now: new Date('2026-09-13T10:00:00.000Z'),
      }),
    ).resolves.toEqual([]);
    await expect(
      findMarketingAutomationCandidates({
        automation,
        now: new Date('2026-09-13T12:00:00.000Z'),
      }),
    ).resolves.toEqual([expect.objectContaining({ triggerKey: 'birthday:2026-09-14' })]);
  });

  it('crée une campagne snapshot et une claim durable, puis reste idempotent', async () => {
    const candidate = {
      customerId: 'customer-1',
      name: 'Alice',
      phone: '+33601020304',
      emailNormalized: null,
      triggerKey: 'first-honored:reservation-1',
      occurredAt: new Date('2026-09-12T10:00:00.000Z'),
      inclusionReason: 'AUTOMATION_AFTER_FIRST_HONORED',
    };
    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.READY,
    } as never);
    vi.mocked(db.marketingAutomationDispatch.create).mockResolvedValue({
      id: 'dispatch-1',
      customerId: candidate.customerId,
      triggerKey: candidate.triggerKey,
      occurredAt: candidate.occurredAt,
      status: MarketingAutomationDispatchStatus.QUEUED,
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { id: 'audience-1', customerId: candidate.customerId },
    ] as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.READY,
      audienceCount: 1,
    } as never);

    await expect(
      createMarketingAutomationCampaign({
        automation: AUTOMATION,
        candidates: [candidate],
        now: NOW,
      }),
    ).resolves.toMatchObject({ campaign: { id: 'campaign-1' }, dispatchCount: 1 });
    expect(db.marketingAutomationDispatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          automationId: 'automation-1',
          triggerKey: candidate.triggerKey,
          campaignId: 'campaign-1',
        }),
      }),
    );
    expect(db.campaignMessage.createMany).toHaveBeenCalled();

    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-2',
      status: MarketingCampaignStatus.READY,
    } as never);
    vi.mocked(db.marketingAutomationDispatch.create).mockRejectedValueOnce({ code: 'P2002' });
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-2',
      status: MarketingCampaignStatus.CANCELLED,
    } as never);
    await expect(
      createMarketingAutomationCampaign({
        automation: AUTOMATION,
        candidates: [candidate],
        now: NOW,
      }),
    ).resolves.toBeNull();
    expect(db.marketingCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: 'AUTOMATION_ALREADY_DISPATCHED' }),
      }),
    );
  });

  it('persiste une automation avec une clé unique par établissement et type', async () => {
    vi.mocked(db.marketingAutomation.upsert).mockResolvedValue({ id: 'automation-1' } as never);
    await expect(
      upsertMarketingAutomation({
        restaurantId: 'restaurant-1',
        type: 'BIRTHDAY',
        channel: 'EMAIL',
        enabled: false,
        config: {
          bodyTemplate: 'Joyeux anniversaire {{customer.firstName}} {{unsubscribeUrl}}',
          subject: 'Un cadeau pour vous',
          daysBefore: 5,
        },
      }),
    ).resolves.toMatchObject({ id: 'automation-1' });
    expect(db.marketingAutomation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId_type: { restaurantId: 'restaurant-1', type: 'BIRTHDAY' } },
        create: expect.objectContaining({ enabled: false, channel: 'EMAIL' }),
      }),
    );
  });

  it('évalue une automation et avance le curseur même sans candidat éligible', async () => {
    vi.mocked(db.customer.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingAutomation.update).mockResolvedValue({} as never);
    await expect(
      evaluateMarketingAutomation({ automation: AUTOMATION, now: NOW }),
    ).resolves.toEqual({
      candidateCount: 0,
      eligibleCount: 0,
      campaignId: null,
    });
    expect(db.marketingAutomation.update).toHaveBeenCalledWith({
      where: { id: 'automation-1' },
      data: { lastEvaluatedAt: NOW },
    });
  });
});
