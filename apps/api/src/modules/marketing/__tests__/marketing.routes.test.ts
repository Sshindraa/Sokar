import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingCampaignStatus, MarketingPermissionStatus } from '@prisma/client';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';

const AUTH = { authorization: 'Bearer test' };
const NOW = new Date('2026-09-14T10:00:00.000Z');
const DEFINITION = {
  version: 1,
  operator: 'AND',
  conditions: [{ field: 'isVip', op: 'EQ', value: true }],
};

describe('marketing control plane routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
    process.env.MARKETING_ATTRIBUTION_SECRET = 'a'.repeat(48);
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
    vi.mocked(db.customerConsent.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingPermission.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingSuppression.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingFrequencyWindow.findMany).mockResolvedValue([]);
    vi.mocked(db.usageEvent.findMany).mockResolvedValue([]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await closeApp();
  });

  it('expose la readiness provider sans valeurs sensibles', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/marketing/providers/readiness',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      data: {
        sendsEnabled: expect.any(Boolean),
        sms: { configured: expect.any(Boolean), callbackConfigured: expect.any(Boolean) },
        email: { configured: expect.any(Boolean), callbackConfigured: expect.any(Boolean) },
        whatsapp: { configured: expect.any(Boolean), callbackConfigured: expect.any(Boolean) },
      },
    });
    expect(JSON.stringify(body)).not.toContain(process.env.TELNYX_API_KEY ?? '__missing_key__');
  });

  it('records a channel opt-in with proof and exposes a tenant-scoped permission list', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'test-rest-1' } as never);
    vi.mocked(db.marketingPermission.upsert).mockResolvedValue({
      id: 'permission-1',
      customerId: 'customer-1',
      channel: 'EMAIL',
      status: MarketingPermissionStatus.OPTED_IN,
    } as never);
    vi.mocked(db.marketingPermissionEvent.create).mockResolvedValue({ id: 'event-1' } as never);

    const updated = await app.inject({
      method: 'PUT',
      url: '/crm/customers/customer-1/marketing-permissions/EMAIL',
      headers: AUTH,
      payload: {
        status: 'OPTED_IN',
        source: 'WEB_FORM',
        proofVersion: 'privacy-2026-09',
        proof: 'consent text version + checkbox',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      data: expect.objectContaining({ id: 'permission-1', status: 'OPTED_IN' }),
    });

    vi.mocked(db.marketingPermission.findMany).mockResolvedValue([
      { id: 'permission-1', channel: 'EMAIL', status: 'OPTED_IN' },
    ] as never);
    const listed = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1/marketing-permissions',
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      data: [{ id: 'permission-1', channel: 'EMAIL', status: 'OPTED_IN' }],
    });
    expect(db.marketingPermission.findMany).toHaveBeenCalledWith({
      where: { restaurantId: 'test-rest-1', customerId: 'customer-1' },
      orderBy: { channel: 'asc' },
    });
  });

  it('previews and creates a draft campaign without sending to a provider', async () => {
    const app = await getApp();
    vi.mocked(db.customerSegment.findFirst).mockResolvedValue({
      id: 'segment-1',
      definition: DEFINITION,
    } as never);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'customer-1',
        name: 'Alice',
        isVip: true,
        phone: '+33601020304',
        emailNormalized: null,
      },
    ] as never);
    vi.mocked(db.marketingPermission.findMany).mockResolvedValue([
      { customerId: 'customer-1', channel: 'SMS', status: 'OPTED_IN', source: 'WEB' },
    ] as never);

    const preview = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/audience-preview',
      headers: AUTH,
      payload: { channel: 'SMS', segmentId: 'segment-1' },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ candidateCount: 1, eligibleCount: 1 });

    vi.mocked(db.marketingCampaign.create).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.DRAFT,
      audienceCount: 1,
    } as never);
    const created = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns',
      headers: AUTH,
      payload: {
        name: 'Relance déjeuner',
        objective: 'Remplir le service de midi',
        channel: 'SMS',
        segmentId: 'segment-1',
        bodyTemplate:
          'Bonjour {{customer.firstName}}, réservez {{reservationLink}} {{unsubscribeUrl}}',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ data: expect.objectContaining({ id: 'campaign-1' }) });
    expect(db.campaignAudienceMember.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ campaignId: 'campaign-1', customerId: 'customer-1' })],
    });
  });

  it('expose et configure les trois automations derrière la capability Pro', async () => {
    const app = await getApp();
    vi.mocked(db.marketingAutomation.findMany).mockResolvedValue([
      {
        id: 'automation-1',
        restaurantId: 'test-rest-1',
        type: 'AFTER_FIRST_HONORED',
        channel: 'SMS',
        enabled: false,
      },
    ] as never);
    const listed = await app.inject({
      method: 'GET',
      url: '/marketing/automations',
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ data: [expect.objectContaining({ id: 'automation-1' })] });

    vi.mocked(db.marketingAutomation.upsert).mockResolvedValue({
      id: 'automation-1',
      type: 'AFTER_FIRST_HONORED',
      enabled: true,
    } as never);
    const updated = await app.inject({
      method: 'PUT',
      url: '/marketing/automations/AFTER_FIRST_HONORED',
      headers: AUTH,
      payload: {
        enabled: true,
        channel: 'SMS',
        config: {
          bodyTemplate: 'Merci {{customer.firstName}} {{unsubscribeUrl}}',
          delayHours: 24,
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ data: expect.objectContaining({ id: 'automation-1' }) });
    expect(db.marketingAutomation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId_type: { restaurantId: 'test-rest-1', type: 'AFTER_FIRST_HONORED' } },
      }),
    );
  });

  it('prepares a non-empty draft and refuses campaign capability on Essential', async () => {
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.DRAFT,
      audienceCount: 1,
    } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.READY,
    } as never);
    const prepared = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/prepare',
      headers: AUTH,
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toEqual({
      data: { id: 'campaign-1', status: MarketingCampaignStatus.READY },
    });

    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'ESSENTIAL' } as never);
    const blocked = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/audience-preview',
      headers: AUTH,
      payload: { channel: 'SMS', segmentId: 'segment-1' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'marketing.campaigns',
    });
  });

  it('returns a rendered campaign preview without creating provider messages', async () => {
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      name: 'Relance déjeuner',
      objective: 'Remplir le service',
      channel: 'SMS',
      status: MarketingCampaignStatus.DRAFT,
      subject: null,
      bodyTemplate:
        'Bonjour {{customer.firstName}}, réservez {{reservationLink}} {{unsubscribeUrl}}',
      scheduledAt: null,
      timezone: 'Europe/Paris',
      audienceCount: 2,
      restaurant: { name: 'Chez Sokar' },
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { customerId: 'customer-1' },
    ] as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ name: 'Alice Martin' } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/preview',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        campaign: { id: 'campaign-1', channel: 'SMS' },
        audience: { captured: 2, sampleCustomer: 'Alice Martin' },
        render: { body: expect.stringContaining('Bonjour Alice') },
        usage: { category: 'SMS_SEGMENTS', totalUnits: 2 },
        costEstimate: { status: 'NOT_AVAILABLE' },
      },
    });
    expect(db.campaignMessage.createMany).not.toHaveBeenCalled();
  });

  it('exposes a manager test as an explicit dry-run while sends are frozen', async () => {
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      name: 'Test gérant',
      objective: 'Contrôle',
      channel: 'EMAIL',
      status: MarketingCampaignStatus.DRAFT,
      subject: 'Aperçu',
      bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      scheduledAt: null,
      timezone: 'Europe/Paris',
      audienceCount: 1,
      restaurant: { name: 'Chez Sokar' },
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([]);

    const response = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/test',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        mode: 'DRY_RUN',
        providerContacted: false,
        recipient: 'MANAGER',
        reason: 'PROVIDER_TEST_NOT_WIRED',
        preview: { render: { subject: 'Aperçu' } },
      },
    });
    expect(db.campaignMessage.create).not.toHaveBeenCalled();
  });

  it('modifie le contenu d’un brouillon et refuse de défiger un snapshot READY', async () => {
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      restaurantId: 'test-rest-1',
      name: 'Ancienne campagne',
      objective: 'Ancien objectif',
      channel: 'SMS',
      status: MarketingCampaignStatus.DRAFT,
      subject: null,
      bodyTemplate: 'Ancien {{unsubscribeUrl}}',
      scheduledAt: null,
      timezone: 'Europe/Paris',
      audienceVersion: 1,
      audienceCount: 1,
      segmentId: 'segment-1',
    } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      name: 'Nouvelle campagne',
      status: MarketingCampaignStatus.DRAFT,
    } as never);

    const updated = await app.inject({
      method: 'PATCH',
      url: '/marketing/campaigns/campaign-1',
      headers: AUTH,
      payload: {
        name: 'Nouvelle campagne',
        bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      data: expect.objectContaining({ id: 'campaign-1', name: 'Nouvelle campagne' }),
    });

    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValueOnce({
      id: 'campaign-1',
      restaurantId: 'test-rest-1',
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
    const frozen = await app.inject({
      method: 'PATCH',
      url: '/marketing/campaigns/campaign-1',
      headers: AUTH,
      payload: { channel: 'EMAIL', subject: 'Objet' },
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json()).toEqual({ error: 'CAMPAIGN_AUDIENCE_FROZEN' });
  });

  it('télécharge le rapport CSV agrégé avec un content-disposition', async () => {
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      name: 'Relance déjeuner',
      channel: 'SMS',
      status: MarketingCampaignStatus.SENT,
      audienceCount: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      completedAt: new Date('2026-09-01T10:05:00.000Z'),
    } as never);
    vi.mocked(db.campaignAudienceMember.findMany).mockResolvedValue([
      { customerId: 'c1' },
    ] as never);
    vi.mocked(db.campaignMessage.findMany).mockResolvedValue([
      { id: 'message-1', status: 'DELIVERED' },
    ] as never);
    vi.mocked(db.marketingAttributionLink.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingConversion.findMany).mockResolvedValue([]);
    vi.mocked(db.marketingPermissionEvent.findMany).mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/marketing/campaigns/campaign-1/report.csv',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('sokar-campaign-campaign-1.csv');
    expect(response.body).toContain('"delivery_delivered","1"');
    expect(response.body).not.toContain('c1');
  });

  it('creates a signed attribution link and keeps the public click response opaque', async () => {
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({ id: 'campaign-1' } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.marketingAttributionLink.upsert).mockResolvedValue({
      id: 'link-1',
      campaignId: 'campaign-1',
      customerId: 'customer-1',
      expiresAt: new Date('2026-09-20T12:00:00.000Z'),
    } as never);

    const created = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/attribution-links',
      headers: AUTH,
      payload: { customerId: 'customer-1', expiresAt: '2026-09-20T12:00:00.000Z' },
    });
    expect(created.statusCode).toBe(201);
    const token = created.json().data.token as string;
    expect(token).toMatch(/^v1\./);
    expect(created.json().data).not.toHaveProperty('phone');

    const click = await app.inject({
      method: 'POST',
      url: '/marketing/attribution/click',
      payload: { token: `${token}tampered` },
    });
    expect(click.statusCode).toBe(400);
    expect(click.json()).toEqual({ error: 'INVALID_ATTRIBUTION_TOKEN' });
  });

  it('refuse le lancement tant que le flag fournisseur reste désactivé', async () => {
    delete process.env.MARKETING_SENDS_ENABLED;
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/send',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'MARKETING_SENDS_DISABLED' });
    expect(queues.marketingCampaign.add).not.toHaveBeenCalled();
  });

  it('programme une campagne READY dans la file avec un délai borné', async () => {
    process.env.MARKETING_SENDS_ENABLED = 'true';
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      restaurantId: 'test-rest-1',
      status: MarketingCampaignStatus.READY,
    } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.SCHEDULED,
    } as never);
    const scheduledAt = new Date(Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/schedule',
      headers: AUTH,
      payload: { scheduledAt: scheduledAt.toISOString() },
    });
    expect(response.statusCode).toBe(200);
    expect(queues.marketingCampaign.add).toHaveBeenCalledWith(
      'send-campaign',
      { campaignId: 'campaign-1', restaurantId: 'test-rest-1' },
      expect.objectContaining({
        jobId: 'marketing-campaign:campaign-1',
        delay: expect.any(Number),
      }),
    );
  });

  it('marque la campagne en échec si l enqueue Redis est ambigu', async () => {
    process.env.MARKETING_SENDS_ENABLED = 'true';
    const app = await getApp();
    vi.mocked(db.marketingCampaign.findFirst).mockResolvedValue({
      id: 'campaign-1',
      restaurantId: 'test-rest-1',
      status: MarketingCampaignStatus.READY,
      scheduledAt: null,
    } as never);
    vi.mocked(db.marketingCampaign.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.marketingCampaign.update).mockResolvedValue({
      id: 'campaign-1',
      status: MarketingCampaignStatus.FAILED,
    } as never);
    vi.mocked(queues.marketingCampaign.add).mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await app.inject({
      method: 'POST',
      url: '/marketing/campaigns/campaign-1/send',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN' });
    expect(db.marketingCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MarketingCampaignStatus.FAILED,
          lastErrorCode: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN',
        }),
      }),
    );
  });
});
