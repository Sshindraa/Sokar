import { FastifyRequest, FastifyReply } from 'fastify';

export async function vapiWebhookGuard(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = req.headers['x-vapi-secret'] as string | undefined;
  if (!secret || secret !== process.env.VAPI_WEBHOOK_SECRET) {
    req.log.warn({ ip: req.ip }, 'Invalid or missing Vapi webhook secret');
    reply.status(403).send({ error: 'Forbidden' });
    return;
  }
}
