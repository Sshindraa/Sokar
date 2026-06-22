import { afterAll, describe, expect, it } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

describe('Observability routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('GET /metrics retourne du texte Prometheus', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const body = res.body;
    // Métriques par défaut prom-client
    expect(body).toContain('process_cpu_user_seconds_total');
    // HELP lines pour nos métriques custom
    expect(body).toContain('# HELP sokar_agentic_pii_leaks_total');
  });

  it('GET /health/observability retourne sentry enabled flag', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/health/observability' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics).toBe(true);
    expect(body.sentry).toBe(false); // pas de SENTRY_DSN en test
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});
