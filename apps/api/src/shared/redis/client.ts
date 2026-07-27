import Redis from 'ioredis';

/**
 * Parse REDIS_URL et isole les DB Redis par environnement.
 *
 * Bug historique : `baseUrl + '/2'` produisait `redis://host:6379/3/2` quand
 * REDIS_URL contenait déjà un path (staging). ioredis prenait le dernier
 * segment (2), donc staging et prod partageaient la même DB de queue →
 * le worker staging volait les jobs analytics de prod.
 *
 * Désormais on extrait la DB de base du path et on l'utilise comme offset :
 *   prod    : redis://host:6379       → session DB 0, cache DB 1, queue DB 2
 *   staging : redis://host:6379/3     → session DB 3, cache DB 4, queue DB 5
 */
export function buildRedisUrls(redisUrl: string): {
  session: string;
  cache: string;
  queue: string;
} {
  const parsed = new URL(redisUrl);
  const baseDb =
    parsed.pathname && parsed.pathname !== '/'
      ? Math.max(0, parseInt(parsed.pathname.slice(1), 10) || 0)
      : 0;
  const authPrefix = parsed.username
    ? `${parsed.username}${parsed.password ? ':' + parsed.password : ''}@`
    : '';
  const redisBase = `${parsed.protocol}//${authPrefix}${parsed.host}`;
  return {
    session: `${redisBase}/${baseDb}`,
    cache: `${redisBase}/${baseDb + 1}`,
    queue: `${redisBase}/${baseDb + 2}`,
  };
}

const urls = buildRedisUrls(process.env.REDIS_URL!);

export const redisSession = new Redis(urls.session);
export const redisCache = new Redis(urls.cache);
export const redisQueue = new Redis(urls.queue, { maxRetriesPerRequest: null });

export async function getCachedContext(key: string) {
  const cached = await redisCache.get(key);
  return cached ? JSON.parse(cached) : null;
}

export async function setCachedContext(key: string, ctx: object, ttl = 300) {
  await redisCache.set(key, JSON.stringify(ctx), 'EX', ttl);
}
