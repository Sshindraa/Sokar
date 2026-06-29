import { FastifyInstance } from 'fastify';
import corsPlugin from '@fastify/cors';

function parseCorsOrigins(): string | string[] {
  // 1. Allowlist explicite via CORS_ORIGINS (ex: "https://app.sokar.fr,https://admin.sokar.fr")
  if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map((s) => s.trim());
    return origins.length === 1 ? origins[0] : origins;
  }

  // 2. Dev localhost
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  // 3. Production Sokar. PUBLIC_URL is intentionally not used here: it is
  // commonly the API's own canonical URL, not a browser client origin.
  // Keep this fallback aligned with the public browser
  // clients (dashboard/widget and Sokar Connect booking flow).
  return ['https://sokar.tech', 'https://www.sokar.tech'];
}

export async function registerCors(app: FastifyInstance) {
  await app.register(corsPlugin, {
    origin: parseCorsOrigins(),
    credentials: true,
  });
}
