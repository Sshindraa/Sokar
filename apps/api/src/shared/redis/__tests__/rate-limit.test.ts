import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { getClientIp } from '../rate-limit';

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
