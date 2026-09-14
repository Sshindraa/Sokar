import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingMessageStatus } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  applyMarketingProviderEvent,
  getMarketingProviderReadiness,
  normalizeMarketingProviderEvent,
  reconcileMarketingProviderEvents,
} from '../marketing-provider.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    campaignMessage: { findFirst: vi.fn(), updateMany: vi.fn() },
    marketingCampaign: { update: vi.fn() },
    marketingProviderReconciliation: {
      upsert: vi.fn().mockResolvedValue({ id: 'reconciliation-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  },
}));

describe('marketing provider reconciliation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaignMessage.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({} as never);
    vi.mocked(db.marketingProviderReconciliation.upsert).mockResolvedValue({
      id: 'reconciliation-1',
    } as never);
    vi.mocked(db.marketingProviderReconciliation.updateMany).mockResolvedValue({
      count: 1,
    } as never);
  });

  it('retourne un état de readiness sans exposer les secrets', () => {
    vi.stubEnv('MARKETING_SENDS_ENABLED', 'false');
    vi.stubEnv('TELNYX_API_KEY', 'telnyx-key');
    vi.stubEnv('TELNYX_FROM_NUMBER', '+33123456789');
    vi.stubEnv('TELNYX_PUBLIC_KEY', 'telnyx-public-key');
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('EMAIL_FROM', 'noreply@example.test');
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'resend-secret');
    vi.stubEnv('MARKETING_WHATSAPP_ENABLED', 'false');

    expect(getMarketingProviderReadiness()).toEqual({
      sendsEnabled: false,
      sendGate: { enabled: false, missing: ['MARKETING_SENDS_ENABLED'] },
      sms: { configured: true, callbackConfigured: true, missing: [], callbackMissing: [] },
      email: { configured: true, callbackConfigured: true, missing: [], callbackMissing: [] },
      whatsapp: {
        configured: false,
        callbackConfigured: true,
        missing: ['MARKETING_WHATSAPP_ENABLED'],
        callbackMissing: [],
      },
    });
    expect(JSON.stringify(getMarketingProviderReadiness())).not.toContain('telnyx-key');
  });

  it('explique une configuration incomplète avec uniquement les noms de variables', () => {
    expect(
      getMarketingProviderReadiness({
        MARKETING_SENDS_ENABLED: 'true',
        MARKETING_WHATSAPP_ENABLED: 'true',
        TELNYX_API_KEY: 'key',
        TELNYX_FROM_NUMBER: '+33123456789',
        RESEND_API_KEY: 'key',
        EMAIL_FROM: 'noreply@example.test',
      }),
    ).toEqual({
      sendsEnabled: true,
      sendGate: { enabled: true, missing: [] },
      sms: {
        configured: true,
        callbackConfigured: false,
        missing: [],
        callbackMissing: ['TELNYX_PUBLIC_KEY'],
      },
      email: {
        configured: true,
        callbackConfigured: false,
        missing: [],
        callbackMissing: ['RESEND_WEBHOOK_SECRET'],
      },
      whatsapp: {
        configured: false,
        callbackConfigured: false,
        missing: ['TELNYX_WHATSAPP_FROM', 'TELNYX_MESSAGING_PROFILE_ID'],
        callbackMissing: ['TELNYX_PUBLIC_KEY'],
      },
    });
    const testTelnyxKey = 'test'.repeat(8);
    expect(
      JSON.stringify(
        getMarketingProviderReadiness({
          TELNYX_API_KEY: testTelnyxKey,
          TELNYX_FROM_NUMBER: '+33123456789',
        }),
      ),
    ).not.toContain(testTelnyxKey);
  });

  it('normalise les événements Telnyx et Resend vers les statuts internes', () => {
    expect(
      normalizeMarketingProviderEvent({
        provider: 'telnyx',
        eventType: 'message.finalized',
        providerStatus: 'delivered',
      }),
    ).toEqual({ status: MarketingMessageStatus.DELIVERED });
    expect(
      normalizeMarketingProviderEvent({
        provider: 'resend',
        eventType: 'email.bounced',
        errorCode: 'mailbox unavailable',
      }),
    ).toEqual({ status: MarketingMessageStatus.BOUNCED, errorCode: 'MAILBOX_UNAVAILABLE' });
    expect(
      normalizeMarketingProviderEvent({ provider: 'resend', eventType: 'email.opened' }),
    ).toEqual({ status: MarketingMessageStatus.DELIVERED });
    expect(
      normalizeMarketingProviderEvent({ provider: 'resend', eventType: 'domain.updated' }),
    ).toBeNull();
  });

  it('avance une CampaignMessage et incrémente deliveredCount une seule fois', async () => {
    vi.mocked(db.campaignMessage.findFirst).mockResolvedValue({
      id: 'message-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      status: MarketingMessageStatus.SENT,
      acceptedAt: new Date('2026-09-13T10:00:00.000Z'),
      sentAt: new Date('2026-09-13T10:00:00.000Z'),
      deliveredAt: null,
      campaign: { restaurantId: 'restaurant-1' },
    } as never);

    const result = await applyMarketingProviderEvent({
      provider: 'resend',
      providerMessageId: 'email-1',
      eventType: 'email.delivered',
      occurredAt: new Date('2026-09-13T10:01:00.000Z'),
    });

    expect(result).toMatchObject({
      matched: true,
      changed: true,
      status: MarketingMessageStatus.DELIVERED,
    });
    expect(db.campaignMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'message-1', status: MarketingMessageStatus.SENT },
        data: expect.objectContaining({ status: MarketingMessageStatus.DELIVERED }),
      }),
    );
    expect(db.marketingCampaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { deliveredCount: { increment: 1 } },
    });
  });

  it('ignore un événement en retard après une livraison', async () => {
    vi.mocked(db.campaignMessage.findFirst).mockResolvedValue({
      id: 'message-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      status: MarketingMessageStatus.DELIVERED,
      acceptedAt: new Date('2026-09-13T10:00:00.000Z'),
      sentAt: new Date('2026-09-13T10:00:00.000Z'),
      deliveredAt: new Date('2026-09-13T10:01:00.000Z'),
      campaign: { restaurantId: 'restaurant-1' },
    } as never);

    const result = await applyMarketingProviderEvent({
      provider: 'telnyx',
      providerMessageId: 'sms-1',
      eventType: 'message.sent',
    });

    expect(result).toMatchObject({ matched: true, changed: false, status: 'DELIVERED' });
    expect(db.campaignMessage.updateMany).not.toHaveBeenCalled();
    expect(db.marketingCampaign.update).not.toHaveBeenCalled();
  });

  it('met en attente un provider id inconnu puis ignore une course perdue', async () => {
    vi.mocked(db.campaignMessage.findFirst).mockResolvedValue(null);
    await expect(
      applyMarketingProviderEvent({
        provider: 'telnyx',
        providerMessageId: 'unknown',
        eventType: 'message.sent',
      }),
    ).resolves.toEqual({ matched: false, changed: false, reconciliationId: 'reconciliation-1' });
    expect(db.marketingProviderReconciliation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: 'telnyx',
          providerMessageId: 'unknown',
          eventType: 'message.sent',
        }),
      }),
    );
    await applyMarketingProviderEvent({
      provider: 'telnyx',
      providerMessageId: 'unknown',
      eventType: 'message.sent',
    });
    expect(db.marketingProviderReconciliation.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { attempts: { increment: 1 }, lastSeenAt: expect.any(Date) },
      }),
    );

    vi.mocked(db.campaignMessage.findFirst).mockResolvedValue({
      id: 'message-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      status: MarketingMessageStatus.SENT,
      acceptedAt: null,
      sentAt: null,
      deliveredAt: null,
      campaign: { restaurantId: 'restaurant-1' },
    } as never);
    vi.mocked(db.campaignMessage.updateMany).mockResolvedValue({ count: 0 } as never);
    await expect(
      applyMarketingProviderEvent({
        provider: 'telnyx',
        providerMessageId: 'sms-1',
        eventType: 'message.finalized',
        providerStatus: 'delivered',
      }),
    ).resolves.toMatchObject({ matched: true, changed: false });
    expect(db.marketingCampaign.update).not.toHaveBeenCalled();
  });

  it('rattache un callback ouvert quand la CampaignMessage est finalement disponible', async () => {
    vi.mocked(db.marketingProviderReconciliation.findMany).mockResolvedValue([
      {
        id: 'reconciliation-1',
        eventKey: 'event-key-1',
        provider: 'telnyx',
        providerMessageId: 'sms-late-1',
        eventType: 'message.finalized',
        providerStatus: 'delivered',
        errorCode: null,
        payloadHash: null,
        occurredAt: new Date('2026-09-14T11:00:00.000Z'),
        status: 'OPEN',
        restaurantId: null,
        campaignMessageId: null,
        attempts: 1,
        firstSeenAt: new Date('2026-09-14T11:00:00.000Z'),
        lastSeenAt: new Date('2026-09-14T11:00:00.000Z'),
        resolvedAt: null,
        resolutionCode: null,
      },
    ] as never);
    vi.mocked(db.campaignMessage.findFirst).mockResolvedValue({
      id: 'message-late-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      status: MarketingMessageStatus.SENT,
      acceptedAt: new Date('2026-09-14T10:59:00.000Z'),
      sentAt: new Date('2026-09-14T10:59:00.000Z'),
      deliveredAt: null,
      campaign: { restaurantId: 'restaurant-1' },
    } as never);
    vi.mocked(db.campaignMessage.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(
      reconcileMarketingProviderEvents({
        limit: 10,
        now: new Date('2026-09-14T11:05:00.000Z'),
      }),
    ).resolves.toEqual({ scanned: 1, resolved: 1, stillOpen: 0 });
    expect(db.marketingProviderReconciliation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reconciliation-1', status: 'OPEN' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          campaignMessageId: 'message-late-1',
          restaurantId: 'restaurant-1',
          resolutionCode: 'RECONCILED_APPLIED',
        }),
      }),
    );
  });
});
