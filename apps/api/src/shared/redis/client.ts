import Redis from 'ioredis';

const baseUrl = process.env.REDIS_URL!;

export const redisSession = new Redis(baseUrl + '/0');
export const redisCache   = new Redis(baseUrl + '/1');
export const redisQueue   = new Redis(baseUrl + '/2');

export async function getCachedContext(key: string) {
  const cached = await redisCache.get(key);
  return cached ? JSON.parse(cached) : null;
}

export async function setCachedContext(key: string, ctx: object, ttl = 300) {
  await redisCache.set(key, JSON.stringify(ctx), 'EX', ttl);
}
