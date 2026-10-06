import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCors } from '../cors';

describe('CORS development origins', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('allows the local Connect app and continues rejecting unlisted origins', async () => {
    const app = Fastify();
    apps.push(app);
    await registerCors(app);
    app.get('/health', async () => ({ ok: true }));

    const connectPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:4002',
        'access-control-request-method': 'GET',
      },
    });
    const unlistedPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:4100',
        'access-control-request-method': 'GET',
      },
    });

    expect(connectPreflight.headers['access-control-allow-origin']).toBe('http://localhost:4002');
    expect(unlistedPreflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
