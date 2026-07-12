/**
 * SEC-006 : /metrics doit être protégé (auth basique ou allowlist IP Prometheus).
 * /health/observability reste public.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { env } from '../../../env';

const originalEnv = {
  METRICS_BASIC_AUTH_USER: env.METRICS_BASIC_AUTH_USER,
  METRICS_BASIC_AUTH_PASSWORD: env.METRICS_BASIC_AUTH_PASSWORD,
  METRICS_ALLOWLIST_IPS: env.METRICS_ALLOWLIST_IPS,
};

describe('observability routes (SEC-006)', () => {
  afterAll(async () => {
    await closeApp();
    env.METRICS_BASIC_AUTH_USER = originalEnv.METRICS_BASIC_AUTH_USER;
    env.METRICS_BASIC_AUTH_PASSWORD = originalEnv.METRICS_BASIC_AUTH_PASSWORD;
    env.METRICS_ALLOWLIST_IPS = originalEnv.METRICS_ALLOWLIST_IPS;
  });

  beforeEach(() => {
    env.METRICS_BASIC_AUTH_USER = undefined;
    env.METRICS_BASIC_AUTH_PASSWORD = undefined;
    env.METRICS_ALLOWLIST_IPS = '127.0.0.1, ::1';
  });

  it('/metrics retourne 200 depuis une IP allowlistée', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('/metrics retourne 403 depuis une IP non allowlistée', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { 'X-Forwarded-For': '192.0.2.1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('/metrics exige un auth basique quand il est configuré', async () => {
    env.METRICS_BASIC_AUTH_USER = 'prometheus';
    env.METRICS_BASIC_AUTH_PASSWORD = 'secret';
    const app = await getApp();

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="metrics"');
  });

  it('/metrics retourne 200 avec un auth basique valide', async () => {
    env.METRICS_BASIC_AUTH_USER = 'prometheus';
    env.METRICS_BASIC_AUTH_PASSWORD = 'secret';
    const app = await getApp();

    const auth = 'Basic ' + Buffer.from('prometheus:secret').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { Authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('/metrics retourne 401 avec un auth basique invalide', async () => {
    env.METRICS_BASIC_AUTH_USER = 'prometheus';
    env.METRICS_BASIC_AUTH_PASSWORD = 'secret';
    const app = await getApp();

    const auth = 'Basic ' + Buffer.from('prometheus:wrong').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { Authorization: auth },
    });
    expect(res.statusCode).toBe(401);
  });

  it('/health/observability reste public', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/health/observability' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics).toBe(true);
    expect(body.sentry).toBeDefined();
  });
});
