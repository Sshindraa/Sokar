/**
 * Garde-fou non-régression du rate-limit global Fastify.
 *
 * Contexte (juillet 2026) : le dashboard affichait un état Error car toutes les
 * requêtes passaient par le proxy Next.js /api/proxy/* et étaient rate-limitées
 * comme venant de 127.0.0.1 (le rate-limit global est à 100 req/min/IP). Le fix
 * a consisté à forwarder X-Forwarded-For depuis le proxy et à activer
 * trustProxy côté API pour que req.ip reflète le vrai client.
 *
 * Ce test prouve que :
 *  1. l'API utilise X-Forwarded-For pour déterminer req.ip (trustProxy) ;
 *  2. 120 requêtes/min depuis la même IP → 429 au-delà de 100 ;
 *  3. 20 requêtes/min depuis 20 IPs différentes → toutes passent (200).
 *
 * On construit une app Fastify fraîche (store in-memory @fastify/rate-limit
 * isolé) pour éviter la pollution du store partagé entre les fichiers de test.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Importer les helpers déclenche les vi.mock globaux (clerk, db, redis, queues)
// nécessaires au boot de buildApp sans services réels.
import '../helpers';
import { buildApp } from '../../main';

const RATE_LIMIT_MAX = 100;

describe('Rate-limit global — non-régression proxy X-Forwarded-For', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('req.ip reflète X-Forwarded-For (trustProxy actif)', async () => {
    // /livez renvoie 200 sans auth ni DB. On vérifie indirectement que
    // request.ip est lu depuis X-Forwarded-For via le comportement du
    // rate-limit par IP (testé explicitement ci-dessous).
    const res = await app.inject({
      method: 'GET',
      url: '/livez',
      headers: { 'X-Forwarded-For': '198.51.100.42' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('120 requêtes depuis la même IP → 429 au-delà de 100', async () => {
    const ip = '203.0.113.10';
    let ok = 0;
    let limited = 0;

    for (let i = 0; i < 120; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/livez',
        headers: { 'X-Forwarded-For': ip },
      });
      if (res.statusCode === 200) ok++;
      else if (res.statusCode === 429) limited++;
    }

    expect(ok).toBe(RATE_LIMIT_MAX);
    expect(limited).toBe(120 - RATE_LIMIT_MAX);
  });

  it('20 requêtes depuis 20 IPs différentes → toutes passent (200)', async () => {
    // Utilise un sous-réseau distinct pour ne pas retomber sur l'IP épuisée
    // par le test précédent (203.0.113.10).
    for (let i = 1; i <= 20; i++) {
      const ip = `192.0.2.${i}`;
      const res = await app.inject({
        method: 'GET',
        url: '/livez',
        headers: { 'X-Forwarded-For': ip },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
