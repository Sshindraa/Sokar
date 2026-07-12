/**
 * SEC-005 : les routes /api/test ne doivent pas être disponibles en production
 * et doivent être contrôlées par une variable d'environnement explicite
 * ENABLE_TEST_ROUTES, pas seulement NODE_ENV.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
// Importer helpers declenche les vi.mock globaux (clerk, db) necessaires au boot.
import '../../../test/helpers';
import { buildApp } from '../../../main';
import { env } from '../../../env';

describe('test routes guard (SEC-005)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('active /api/test quand ENABLE_TEST_ROUTES=true', async () => {
    env.ENABLE_TEST_ROUTES = 'true';
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test/restaurants',
    });

    expect(res.statusCode).toBe(200);
  });

  it('retourne 404 quand ENABLE_TEST_ROUTES=false', async () => {
    env.ENABLE_TEST_ROUTES = 'false';
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test/restaurants',
    });

    expect(res.statusCode).toBe(404);
  });
});
