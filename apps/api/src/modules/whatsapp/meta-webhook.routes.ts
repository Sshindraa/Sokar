import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RATE_LIMIT_PROVIDER_WEBHOOK } from '../../plugins/rate-limit.policy';
import { redisQueue } from '../../shared/redis/client';
import { readMetaDeliveryStatus, storeMetaStatus } from '../../shared/whatsapp/meta-status';
import { queues } from '../../shared/queue/queues';

const payloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        id: z.string().max(128),
        changes: z
          .array(
            z.object({
              field: z.string().max(128),
              value: z.object({
                metadata: z.object({ phone_number_id: z.string().max(128) }).optional(),
                statuses: z
                  .array(
                    z.object({
                      id: z.string().min(1).max(512),
                      status: z.string().max(64),
                    }),
                  )
                  .max(100)
                  .optional(),
              }),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function metaWhatsAppWebhookRoutes(app: FastifyInstance) {
  // Do not let the global error handler export verification query secrets to Sentry.
  app.setErrorHandler<FastifyError>((error, _req, reply) => {
    const code =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 503;
    return reply.code(code).send();
  });
  const options = {
    // The GET query contains a verification secret. Never emit request URLs for this route.
    logLevel: 'silent' as const,
    bodyLimit: 256 * 1024,
    config: { rateLimit: RATE_LIMIT_PROVIDER_WEBHOOK },
  };
  const enabled = () => process.env.META_WHATSAPP_WEBHOOK_ENABLED === 'true';

  app.get('/webhooks/meta/whatsapp', options, async (req, reply) => {
    if (!enabled()) return reply.code(404).send();
    const token = process.env.META_WHATSAPP_VERIFY_TOKEN;
    if (!token) return reply.code(503).send();
    const query = req.query as Record<string, unknown>;
    if (
      query['hub.mode'] !== 'subscribe' ||
      typeof query['hub.verify_token'] !== 'string' ||
      !sameSecret(query['hub.verify_token'], token) ||
      typeof query['hub.challenge'] !== 'string' ||
      !/^\d{1,128}$/.test(query['hub.challenge'])
    )
      return reply.code(403).send();
    return reply.type('text/plain').send(query['hub.challenge']);
  });

  app.post('/webhooks/meta/whatsapp', options, async (req, reply) => {
    if (!enabled()) return reply.code(404).send();
    const secret = process.env.META_WHATSAPP_APP_SECRET;
    const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const wabaId = process.env.META_WHATSAPP_WABA_ID;
    if (!secret || !phoneId || !wabaId) return reply.code(503).send();
    const signature = req.headers['x-hub-signature-256'];
    if (!req.rawBody || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
      return reply.code(401).send();
    }
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    if (!sameSecret(signature, expected)) return reply.code(401).send();
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send();
    try {
      for (const entry of parsed.data.entry) {
        if (entry.id !== wabaId) continue;
        for (const change of entry.changes) {
          if (change.field !== 'messages' || change.value.metadata?.phone_number_id !== phoneId)
            continue;
          for (const status of change.value.statuses ?? []) {
            if (
              status.status === 'sent' ||
              status.status === 'failed' ||
              status.status === 'delivered' ||
              status.status === 'read'
            ) {
              await storeMetaStatus(redisQueue, phoneId, status.id, status.status);
              if (
                status.status === 'failed' &&
                (await readMetaDeliveryStatus(redisQueue, phoneId, status.id)) === 'failed'
              ) {
                // Acceptance claims are never released by a delivery failure.
                // Keep the provider receipt for manual correlation, not recipient/body data.
                const fingerprint = createHash('sha256')
                  .update(`${phoneId}:${status.id}`)
                  .digest('hex');
                await queues.deadLetter.add(
                  'whatsapp-delivery-manual',
                  {
                    kind: 'whatsapp-delivery-manual',
                    provider: 'meta',
                    channel: 'whatsapp',
                    providerMessageId: status.id,
                    reason: 'delivery_failed',
                  },
                  { jobId: `meta-whatsapp-delivery_${fingerprint}` },
                );
              }
            }
          }
        }
      }
    } catch {
      // Let Meta retry. Do not log raw payloads, recipients, or provider errors.
      return reply.code(503).send();
    }
    return reply.send({ result: 'ok' });
  });
}
