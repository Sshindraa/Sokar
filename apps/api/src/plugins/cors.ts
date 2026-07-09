import { FastifyInstance } from 'fastify';
import corsPlugin from '@fastify/cors';
import { env } from '../env';

function parseCorsOrigins(): string | string[] {
  // 1. Allowlist explicite via CORS_ORIGINS (ex: "https://sokar.tech,https://www.sokar.tech")
  //    En production, CORS_ORIGINS est validé par EnvSchema (fail-fast si absent).
  if (env.CORS_ORIGINS) {
    const origins = env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
  }

  // 2. Dev localhost (uniquement en non-production — en prod, env.ts a déjà crashé)
  return ['http://localhost:3000', 'http://127.0.0.1:3000'];
}

export async function registerCors(app: FastifyInstance) {
  await app.register(corsPlugin, {
    origin: parseCorsOrigins(),
    credentials: true,
  });
}
