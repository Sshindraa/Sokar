import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const SECRET = `whsec_${Buffer.from('resend-route-secret').toString('base64')}`;
const INTERNAL_MARKETING_TOKEN = 'test'.repeat(8);

function signedBody(body: string, id = 'evt-route-1') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', Buffer.from('resend-route-secret'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    id,
    timestamp,
    signature: `v1,${signature}`,
  };
}

describe('POST /marketing/webhooks/resend', () => {
  let app: FastifyInstance;
  let previousSecret: string | undefined;
  let previousMarketingToken: string | undefined;

  beforeEach(async () => {
    previousSecret = process.env.RESEND_WEBHOOK_SECRET;
    previousMarketingToken = process.env.SOKAR_INTERNAL_MARKETING_TOKEN;
    delete process.env.SOKAR_INTERNAL_MARKETING_TOKEN;
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    app = await getApp();
  });

  afterAll(async () => {
    if (previousSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = previousSecret;
    if (previousMarketingToken === undefined) delete process.env.SOKAR_INTERNAL_MARKETING_TOKEN;
    else process.env.SOKAR_INTERNAL_MARKETING_TOKEN = previousMarketingToken;
    await closeApp();
  });

  it('vérifie la signature et accuse réception d’un événement inconnu localement', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: { email_id: 'unknown-email' },
    });
    const signed = signedBody(body);
    const response = await app.inject({
      method: 'POST',
      url: '/marketing/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      result: 'reconciliation_pending',
      changed: false,
      reconciliationId: expect.any(String),
    });
  });

  it('refuse une signature incorrecte avant de lire le payload métier', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'unknown-email' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/marketing/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'evt-route-2',
        'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
        'svix-signature': 'v1,invalid',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.payload)).toEqual({ error: 'INVALID_RESEND_WEBHOOK_SIGNATURE' });
  });

  it('protège le feed interne de réconciliation avec un jeton séparé', async () => {
    process.env.SOKAR_INTERNAL_MARKETING_TOKEN = INTERNAL_MARKETING_TOKEN;
    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/internal/marketing/reconciliation',
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/internal/marketing/reconciliation?status=OPEN&limit=10',
      headers: { 'x-sokar-internal-marketing-token': INTERNAL_MARKETING_TOKEN },
    });
    expect(authorized.statusCode).toBe(200);
    expect(JSON.parse(authorized.payload)).toEqual({ data: [] });
  });

  it('permet de marquer manuellement une réconciliation comme ignorée', async () => {
    process.env.SOKAR_INTERNAL_MARKETING_TOKEN = INTERNAL_MARKETING_TOKEN;
    vi.mocked(db.marketingProviderReconciliation.updateMany).mockResolvedValue({
      count: 1,
    } as never);
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/marketing/reconciliation/reconciliation-1/ignore',
      headers: {
        'x-sokar-internal-marketing-token': INTERNAL_MARKETING_TOKEN,
        'content-type': 'application/json',
      },
      payload: { reason: 'TRANSACTIONAL_MESSAGE' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
    expect(db.marketingProviderReconciliation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reconciliation-1', status: 'OPEN' },
        data: expect.objectContaining({
          status: 'IGNORED',
          resolutionCode: 'MANUAL_TRANSACTIONAL_MESSAGE',
        }),
      }),
    );
  });
});
