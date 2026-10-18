import { createHmac, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redisQueue } from '../../../shared/redis/client';
import { metaWhatsAppWebhookRoutes } from '../meta-webhook.routes';
import { queues } from '../../../shared/queue/queues';

vi.mock('../../../shared/redis/client', () => ({
  redisQueue: { eval: vi.fn().mockResolvedValue(1), get: vi.fn() },
}));
vi.mock('../../../shared/queue/queues', () => ({
  queues: { deadLetter: { add: vi.fn().mockResolvedValue({}) } },
}));

describe('Meta WhatsApp status webhook', () => {
  let app: FastifyInstance;
  let secret: string;
  const payload = (status = 'delivered', phone = '123', waba = '456') => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: waba,
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: phone },
              statuses: [{ id: 'wamid.test', status }],
            },
          },
        ],
      },
    ],
  });
  const signed = (body: string) => ({
    'content-type': 'application/json',
    'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    secret = randomUUID();
    vi.stubEnv('META_WHATSAPP_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_APP_SECRET', secret);
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123');
    vi.stubEnv('META_WHATSAPP_WABA_ID', '456');
    vi.stubEnv('META_WHATSAPP_VERIFY_TOKEN', secret);
    app = Fastify();
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      req.rawBody = body;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new Error('Invalid JSON'));
      }
    });
    await app.register(metaWhatsAppWebhookRoutes);
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('verifies the subscription challenge without echoing the token', async () => {
    const response = await app.inject({
      url: `/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${secret}&hub.challenge=12345`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('12345');
    expect(
      (
        await app.inject({
          url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('stays disabled by default and fails closed on missing configuration', async () => {
    vi.stubEnv('META_WHATSAPP_WEBHOOK_ENABLED', 'false');
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/meta/whatsapp', payload: payload() }))
        .statusCode,
    ).toBe(404);
    vi.stubEnv('META_WHATSAPP_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_APP_SECRET', '');
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/meta/whatsapp', payload: payload() }))
        .statusCode,
    ).toBe(503);
    expect(redisQueue.eval).not.toHaveBeenCalled();
  });

  it('rejects missing signatures and even a one-byte body change', async () => {
    const body = JSON.stringify(payload());
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/meta/whatsapp', payload: payload() }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: `${body} `,
        })
      ).statusCode,
    ).toBe(401);
    expect(redisQueue.eval).not.toHaveBeenCalled();
  });

  it.each(['sent', 'failed', 'delivered', 'read'])(
    'stores only the signed, scoped %s receipt',
    async (status) => {
      const body = JSON.stringify(payload(status));
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: signed(body),
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(redisQueue.eval).toHaveBeenCalledTimes(1);
      const args = vi.mocked(redisQueue.eval).mock.calls[0];
      expect(args[2]).toMatch(/^whatsapp:meta:status:[a-f0-9]{64}$/);
      expect(JSON.stringify(args)).not.toContain('wamid.test');
    },
  );

  it.each([
    ['999', '456'],
    ['123', '999'],
  ])('ignores other numbers and WABAs', async (phone, waba) => {
    const body = JSON.stringify(payload('delivered', phone, waba));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expect(redisQueue.eval).not.toHaveBeenCalled();
  });

  it('ignores unsupported statuses and inbound messages', async () => {
    const body = JSON.stringify(payload('unknown'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expect(redisQueue.eval).not.toHaveBeenCalled();
  });

  it('returns 503 on storage failure so Meta can retry safely', async () => {
    vi.mocked(redisQueue.eval).mockRejectedValueOnce(new Error('Unavailable'));
    const body = JSON.stringify(payload());
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(503);
  });

  it('opens a deterministic manual review for a delivery failure, without resending', async () => {
    vi.mocked(redisQueue.get).mockResolvedValueOnce('2');
    const body = JSON.stringify(payload('failed'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expect(queues.deadLetter.add).toHaveBeenCalledWith(
      'whatsapp-delivery-manual',
      expect.objectContaining({ providerMessageId: 'wamid.test', reason: 'delivery_failed' }),
      { jobId: expect.stringMatching(/^meta-whatsapp-delivery_[a-f0-9]{64}$/) },
    );
  });

  it('does not open a failure review when delivery/read proof already exists', async () => {
    vi.mocked(redisQueue.get).mockResolvedValueOnce('4');
    const body = JSON.stringify(payload('failed'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expect(queues.deadLetter.add).not.toHaveBeenCalled();
  });

  it('asks Meta to retry if the manual review queue is unavailable', async () => {
    vi.mocked(redisQueue.get).mockResolvedValueOnce('2');
    vi.mocked(queues.deadLetter.add).mockRejectedValueOnce(new Error('queue unavailable'));
    const body = JSON.stringify(payload('failed'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/meta/whatsapp',
          headers: signed(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(503);
  });
});
