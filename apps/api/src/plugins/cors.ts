import { FastifyInstance } from 'fastify';
import corsPlugin from '@fastify/cors';

function parseCorsOrigins(): string | string[] {
  // 1. Allowlist explicite via CORS_ORIGINS (ex: "https://app.sokar.fr,https://admin.sokar.fr")
  if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map((s) => s.trim());
    return origins.length === 1 ? origins[0] : origins;
  }

  // 2. PUBLIC_URL fallback
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }

  // 3. Dev localhost
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  // 4. Sécurité : dernier recours (ne devrait jamais arriver si configuré correctement)
  return 'https://app.sokar.fr';
}

export async function registerCors(app: FastifyInstance) {
  await app.register(corsPlugin, {
    origin: parseCorsOrigins(),
    credentials: true,
  });
}
