import { FastifyInstance } from 'fastify';
import rateLimitPlugin from '@fastify/rate-limit';

export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimitPlugin, {
    max: 100,
    timeWindow: '1 minute',
  });
}
