import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { getClientIp } from '../rate-limit';
import { redisCache } from '../client';

describe('checkRateLimit', () => {
  it('garde la fenêtre de 60 s par défaut, et accepte une fenêtre donnée', async () => {
    // Le module est mocké globalement dans les tests : on prend la version réelle.
    const { checkRateLimit } =
      await vi.importActual<typeof import('../rate-limit')>('../rate-limit');
    vi.mocked(redisCache.incr).mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await checkRateLimit('short', 10);
    await checkRateLimit('daily', 100, 86_400);

    expect(redisCache.expire).toHaveBeenCalledWith('short', 60);
    expect(redisCache.expire).toHaveBeenCalledWith('daily', 86_400);
  });
});

describe('getClientIp', () => {
  it('ignore un préfixe X-Forwarded-For fourni par le client', async () => {
    const app = Fastify({ trustProxy: ['127.0.0.1'] });
    app.get('/ip', async (req) => ({ ip: getClientIp(req) }));

    // Nginx ajoute l'IP réelle après celle que le client a forgée.
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' },
    });

    expect(res.json()).toEqual({ ip: '198.51.100.7' });
    await app.close();
  });
});
