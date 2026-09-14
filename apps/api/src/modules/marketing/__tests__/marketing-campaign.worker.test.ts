import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingCampaignStatus, MarketingMessageStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import {
  processMarketingCampaignJob,
  type MarketingCampaignWorkerDependencies,
} from '../marketing-campaign.worker';

function makeJob(): Job<{ campaignId: string; restaurantId: string }> {
  return {
    id: 'job-1',
    name: 'send-campaign',
    data: { campaignId: 'campaign-1', restaurantId: 'restaurant-1' },
  } as unknown as Job<{ campaignId: string; restaurantId: string }>;
}

function makeDependencies() {
  const campaignMessageFindMany = vi
    .fn()
    .mockResolvedValueOnce([
      {
        id: 'message-1',
        customerId: 'customer-1',
        customer: {
          id: 'customer-1',
          name: 'Alice Martin',
          phone: '+33601020304',
          emailNormalized: null,
        },
      },
    ])
    .mockResolvedValue([]);
  const campaignMessageUpdateMany = vi
    .fn()
    .mockImplementation((args: { where?: { updatedAt?: unknown } }) =>
      Promise.resolve({ count: args.where?.updatedAt ? 0 : 1 }),
    );
  const db = {
    marketingCampaign: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'campaign-1',
        restaurantId: 'restaurant-1',
        channel: 'SMS',
        status: MarketingCampaignStatus.READY,
        subject: null,
        bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
        restaurant: { name: 'Chez Sokar', slug: 'chez-sokar' },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    campaignAudienceMember: {
      findMany: vi.fn().mockResolvedValue([{ id: 'audience-1', customerId: 'customer-1' }]),
    },
    campaignMessage: {
      findMany: campaignMessageFindMany,
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: campaignMessageUpdateMany,
      count: vi.fn().mockResolvedValue(0),
    },
    marketingPermission: { findUnique: vi.fn().mockResolvedValue(null) },
    marketingSuppression: { findFirst: vi.fn().mockResolvedValue(null) },
    marketingFrequencyWindow: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
    customerConsent: { findFirst: vi.fn().mockResolvedValue(null) },
    customer: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
  } as unknown as PrismaClient;
  const sendSms = vi.fn().mockResolvedValue({
    outcome: 'success',
    provider: 'telnyx',
    channel: 'sms',
    providerMessageId: 'telnyx-1',
  });
  const deps: MarketingCampaignWorkerDependencies = {
    db: db as MarketingCampaignWorkerDependencies['db'],
    sendSms,
    sendEmail: vi.fn(),
    sendWhatsApp: vi.fn(),
    createUnsubscribeToken: vi.fn().mockResolvedValue('unsubscribe-token'),
    sendsEnabled: true,
    now: () => new Date('2026-09-13T12:00:00.000Z'),
  };
  return { db, deps, sendSms };
}

describe('marketing campaign worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_URL = 'https://api.sokar.test';
  });

  it('recontrôle le consentement, rend le message et persiste un accept provider', async () => {
    const { db, deps, sendSms } = makeDependencies();
    vi.mocked(db.marketingPermission.findUnique).mockResolvedValue({ status: 'OPTED_IN' } as never);

    await expect(processMarketingCampaignJob(makeJob(), deps)).resolves.toEqual({
      processed: 1,
      accepted: 1,
      failed: 0,
    });
    expect(sendSms).toHaveBeenCalledWith(
      '+33601020304',
      expect.stringContaining('Bonjour Alice'),
      expect.objectContaining({ sourceType: 'marketing_campaign', sourceId: 'message-1' }),
    );
    expect(db.campaignMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'message-1', status: MarketingMessageStatus.SENDING },
        data: expect.objectContaining({
          status: MarketingMessageStatus.ACCEPTED,
          providerMessageId: 'telnyx-1',
        }),
      }),
    );
    expect(db.marketingCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptedCount: { increment: 1 } }),
      }),
    );
  });

  it('annule la ligne si le consentement est retiré entre snapshot et envoi', async () => {
    const { db, deps, sendSms } = makeDependencies();
    vi.mocked(db.marketingPermission.findUnique).mockResolvedValue({
      status: 'OPTED_OUT',
    } as never);

    await expect(processMarketingCampaignJob(makeJob(), deps)).resolves.toMatchObject({
      processed: 1,
      accepted: 0,
    });
    expect(sendSms).not.toHaveBeenCalled();
    expect(db.campaignMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: MarketingMessageStatus.CANCELLED, errorCode: 'OPTED_OUT' },
      }),
    );
  });

  it('crée un lien d attribution par destinataire et l injecte dans reservationLink', async () => {
    const { db, deps, sendSms } = makeDependencies();
    const attributionToken = ['v1', 'payload', 'signature'].join('.');
    vi.mocked(db.marketingPermission.findUnique).mockResolvedValue({ status: 'OPTED_IN' } as never);
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      restaurantId: 'restaurant-1',
      channel: 'SMS',
      status: MarketingCampaignStatus.READY,
      subject: null,
      bodyTemplate: 'Réservez ici : {{reservationLink}}',
      restaurant: { name: 'Chez Sokar', slug: 'chez-sokar' },
    } as never);
    const createAttributionLink = vi.fn().mockResolvedValue({
      token: attributionToken,
      link: { id: 'link-1' },
    });
    deps.createAttributionLink = createAttributionLink as never;

    await expect(processMarketingCampaignJob(makeJob(), deps)).resolves.toMatchObject({
      processed: 1,
      accepted: 1,
    });
    expect(createAttributionLink).toHaveBeenCalledWith({
      restaurantId: 'restaurant-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      issuedAt: new Date('2026-09-13T12:00:00.000Z'),
    });
    expect(sendSms).toHaveBeenCalledWith(
      '+33601020304',
      `Réservez ici : http://localhost:3000/book/chez-sokar?marketingAttributionToken=${attributionToken}`,
      expect.anything(),
    );
  });
});
