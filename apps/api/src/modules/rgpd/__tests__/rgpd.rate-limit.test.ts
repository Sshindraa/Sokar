/**
 * Rate-limit par endpoint RGPD (SEC-004).
 *
 * Les routes sensibles doivent être plus restrictives que le global 100 req/min.
 * On injecte avec un X-Forwarded-For distinct à chaque test pour que le store
 * de @fastify/rate-limit soit isolé et qu'on puisse reproduire le 429.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

let ipCounter = 0;

function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${100 + ipCounter}`;
}

function headers(ip: string) {
  return { 'X-Forwarded-For': ip };
}

describe('RGPD routes rate-limit (SEC-004)', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('POST /api/rgpd/request-verification est limité à 5 req/min', async () => {
    const app = await getApp();
    const ip = uniqueIp();

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/request-verification',
        headers: headers(ip),
        payload: { subject: 'x' },
      });
      expect(res.statusCode).toBe(400);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/rgpd/request-verification',
      headers: headers(ip),
      payload: { subject: 'x' },
    });
    expect(res.statusCode).toBe(429);
  });

  it('POST /api/rgpd/confirm-verification est limité à 10 req/min', async () => {
    const app = await getApp();
    const ip = uniqueIp();

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/confirm-verification',
        headers: headers(ip),
        payload: { subject: 'x' },
      });
      expect(res.statusCode).toBe(400);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/rgpd/confirm-verification',
      headers: headers(ip),
      payload: { subject: 'x' },
    });
    expect(res.statusCode).toBe(429);
  });

  it('GET /api/rgpd/confirm-link est limité à 10 req/min', async () => {
    const app = await getApp();
    const ip = uniqueIp();

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/rgpd/confirm-link',
        headers: headers(ip),
      });
      expect(res.statusCode).toBe(400);
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/rgpd/confirm-link',
      headers: headers(ip),
    });
    expect(res.statusCode).toBe(429);
  });

  it('POST /api/rgpd/erase est limité à 10 req/min', async () => {
    const app = await getApp();
    const ip = uniqueIp();

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/erase',
        headers: headers(ip),
        payload: { subject: 'x' },
      });
      expect(res.statusCode).toBe(400);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/rgpd/erase',
      headers: headers(ip),
      payload: { subject: 'x' },
    });
    expect(res.statusCode).toBe(429);
  });

  it('POST /api/rgpd/export est limité à 10 req/min', async () => {
    const app = await getApp();
    const ip = uniqueIp();

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/export',
        headers: headers(ip),
        payload: { subject: 'x' },
      });
      expect(res.statusCode).toBe(400);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/rgpd/export',
      headers: headers(ip),
      payload: { subject: 'x' },
    });
    expect(res.statusCode).toBe(429);
  });

  it('POST /api/rgpd/withdraw-marketing est limité à 10 req/min', async () => {
    const app = await getApp();
    const ip = uniqueIp();

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/withdraw-marketing',
        headers: headers(ip),
        payload: { subject: 'x' },
      });
      expect(res.statusCode).toBe(400);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/rgpd/withdraw-marketing',
      headers: headers(ip),
      payload: { subject: 'x' },
    });
    expect(res.statusCode).toBe(429);
  });
});
