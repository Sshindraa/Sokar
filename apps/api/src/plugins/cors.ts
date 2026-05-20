import { FastifyInstance } from 'fastify';
import corsPlugin from '@fastify/cors';

export async function registerCors(app: FastifyInstance) {
  await app.register(corsPlugin, {
    origin: process.env.NODE_ENV === 'production'
      ? process.env.PUBLIC_URL ?? 'https://app.sokar.fr'
      : true,
    credentials: true,
  });
}
