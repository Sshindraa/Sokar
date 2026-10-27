import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MarketingAutomationType,
  MarketingCampaignStatus,
  MarketingPermissionStatus,
} from '@prisma/client';
import { db } from '../../../shared/db/client';
import { logger } from '../../../shared/logger/pino';
import { marketingOptOutHash } from '../marketing-opt-out.service';
import {
  automationPriority,
  createMarketingAutomationCampaign,
  evaluateMarketingAutomation,
  evaluateMarketingAutomations,
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
    marketingOptOut: { findMany: vi.fn() },
    marketingAutomation: { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    marketingAutomationDispatch: {
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    marketingCampaign: { create: vi.fn(), update: vi.fn() },
    campaignAudienceMember: { findMany: vi.fn(), createMany: vi.fn() },
    campaignMessage: { count: vi.fn(), createMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
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

const EMAIL_AUTOMATION = {
  ...AUTOMATION,
  channel: 'EMAIL',
  config: { ...(AUTOMATION.config as object), subject: 'Merci' },
} as unknown as AutomationFixture;

function candidateFor(customerId: string, occurredAt: string) {
  return {
    customerId,
    name: 'Client',
    phone: '',
    emailNormalized: `${customerId}@example.com`,
    triggerKey: `first-honored:${customerId}`,
    occurredAt: new Date(occurredAt),
    inclusionReason: 'AUTOMATION_AFTER_FIRST_HONORED',
  };
}

describe('marketing automation engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.customerConsent.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingPermission.findMany).mockResolvedValue([
      { customerId: 'customer-1', status: MarketingPermissionStatus.OPTED_IN },
    ] as never);
    vi.mocked(db.marketingSuppression.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingFrequencyWindow.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingOptOut.findMany).mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllEnvs());

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

  it('exclut une adresse inscrite au registre d’opposition, même consentie en base', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
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
    vi.mocked(db.marketingOptOut.findMany).mockResolvedValue([
      { addressHash: marketingOptOutHash('SMS', '+33601020304') },
    ] as never);

    vi.mocked(db.marketingAutomation.update).mockResolvedValue({} as never);

    await expect(
      evaluateMarketingAutomation({ automation: AUTOMATION, now: NOW }),
    ).resolves.toEqual({ candidateCount: 1, eligibleCount: 0, campaignId: null, deferred: 0 });
    expect(db.marketingCampaign.create).not.toHaveBeenCalled();
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

  it('découpe un lot e-mail sur le reste du budget : les échéances proches passent, le reste reste candidat', async () => {
    vi.mocked(db.campaignMessage.count).mockImplementation((async ({
      where,
    }: {
      where: { acceptedAt?: unknown };
    }) => (where.acceptedAt ? 0 : 38)) as never);
    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-email',
      status: MarketingCampaignStatus.READY,
    } as never);
    vi.mocked(db.marketingAutomationDispatch.findMany).mockResolvedValueOnce([
      { customerId: 'customer-2', triggerKey: 'first-honored:customer-2', occurredAt: NOW },
      { customerId: 'customer-1', triggerKey: 'first-honored:customer-1', occurredAt: NOW },
    ] as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([] as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-email',
      audienceCount: 2,
    } as never);

    // 38 e-mails attendent déjà : il reste 2 ; la plus proche (09-11) puis 09-12 passent, 09-13 attend.
    const result = await createMarketingAutomationCampaign({
      automation: EMAIL_AUTOMATION,
      candidates: [
        candidateFor('customer-1', '2026-09-12T10:00:00.000Z'),
        candidateFor('customer-3', '2026-09-13T10:00:00.000Z'),
        candidateFor('customer-2', '2026-09-11T10:00:00.000Z'),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({
      campaign: { id: 'campaign-email' },
      dispatchCount: 2,
      deferred: 1,
    });
    expect(db.marketingAutomationDispatch.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ customerId: 'customer-2' }),
          expect.objectContaining({ customerId: 'customer-1' }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('un budget épuisé ne crée ni campagne ni occasion : le lot reste candidat', async () => {
    vi.mocked(db.campaignMessage.count).mockImplementation((async ({
      where,
    }: {
      where: { acceptedAt?: unknown };
    }) => (where.acceptedAt ? 0 : 40)) as never);

    await expect(
      createMarketingAutomationCampaign({
        automation: EMAIL_AUTOMATION,
        candidates: [candidateFor('customer-1', '2026-09-12T10:00:00.000Z')],
        now: NOW,
      }),
    ).resolves.toEqual({ campaign: null, dispatchCount: 0, deferred: 1 });
    expect(db.marketingCampaign.create).not.toHaveBeenCalled();
    expect(db.marketingAutomationDispatch.createMany).not.toHaveBeenCalled();
  });

  it('une occasion déjà servie n’est jamais renvoyée par le finder', async () => {
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
      {
        id: 'customer-2',
        name: 'Bob',
        phone: '+33601020305',
        emailNormalized: null,
        timelineEvents: [
          {
            id: 'event-2',
            sourceId: 'reservation-2',
            occurredAt: new Date('2026-09-12T10:00:00.000Z'),
          },
        ],
      },
    ] as never);
    vi.mocked(db.marketingAutomationDispatch.findMany).mockResolvedValueOnce([
      { customerId: 'customer-1', triggerKey: 'first-honored:reservation-1' },
    ] as never);

    await expect(
      findMarketingAutomationCandidates({ automation: AUTOMATION, now: NOW }),
    ).resolves.toEqual([expect.objectContaining({ customerId: 'customer-2' })]);
  });

  it('un seul avertissement par automatisation et par jour quand le budget est atteint', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.mocked(db.marketingAutomation.findMany).mockResolvedValue([
      { ...EMAIL_AUTOMATION, id: 'automation-warn' },
    ] as never);
    vi.mocked(db.customer.findMany).mockResolvedValue(
      ['customer-1', 'customer-2'].map((id) => ({
        id,
        name: 'Client',
        phone: '',
        emailNormalized: `${id}@example.com`,
        timelineEvents: [
          {
            id: `event-${id}`,
            sourceId: `reservation-${id}`,
            occurredAt: new Date('2026-09-12T10:00:00.000Z'),
          },
        ],
      })) as never,
    );
    vi.mocked(db.marketingPermission.findMany).mockResolvedValue(
      ['customer-1', 'customer-2'].map((customerId) => ({
        customerId,
        status: MarketingPermissionStatus.OPTED_IN,
      })) as never,
    );
    vi.mocked(db.campaignMessage.count).mockImplementation((async ({
      where,
    }: {
      where: { acceptedAt?: unknown };
    }) => (where.acceptedAt ? 0 : 40)) as never);

    await evaluateMarketingAutomations({ now: NOW });
    await evaluateMarketingAutomations({ now: NOW });
    await evaluateMarketingAutomations({ now: new Date(NOW.getTime() + 86_400_000) });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: 'automation-warn', deferred: 2 }),
      expect.any(String),
    );
    warn.mockRestore();
  });

  it('les anniversaires passent avant les autres automatisations, à toute la plateforme', () => {
    const types = ['AFTER_FIRST_HONORED', 'DORMANT', 'BIRTHDAY'].map((type) => ({ type }));

    expect(
      types
        .sort((a, b) => automationPriority(a as never) - automationPriority(b as never))
        .map((a) => a.type),
    ).toEqual(['BIRTHDAY', 'AFTER_FIRST_HONORED', 'DORMANT']);
  });

  it('crée une campagne snapshot et une claim durable, puis reste idempotent', async () => {
    const candidate = candidateFor('customer-1', '2026-09-12T10:00:00.000Z');
    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.READY,
    } as never);
    vi.mocked(db.marketingAutomationDispatch.findMany).mockResolvedValueOnce([
      {
        customerId: candidate.customerId,
        triggerKey: candidate.triggerKey,
        occurredAt: candidate.occurredAt,
      },
    ] as never);
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
    ).resolves.toMatchObject({ campaign: { id: 'campaign-1' }, dispatchCount: 1, deferred: 0 });
    expect(db.marketingAutomationDispatch.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            automationId: 'automation-1',
            triggerKey: candidate.triggerKey,
            campaignId: 'campaign-1',
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(db.campaignMessage.createMany).toHaveBeenCalled();

    // Rejouée : l'occasion est déjà servie, aucune campagne ne naît.
    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-2',
      status: MarketingCampaignStatus.READY,
    } as never);
    vi.mocked(db.marketingAutomationDispatch.findMany).mockResolvedValueOnce([] as never);
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
    ).resolves.toEqual({ campaign: null, dispatchCount: 0, deferred: 0 });
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
      deferred: 0,
    });
    expect(db.marketingAutomation.update).toHaveBeenCalledWith({
      where: { id: 'automation-1' },
      data: { lastEvaluatedAt: NOW },
    });
  });
});
