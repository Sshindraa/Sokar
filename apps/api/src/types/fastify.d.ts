import type { Redis } from 'ioredis';
import type { db } from '../shared/db/client';
import type { queues } from '../shared/queue/queues';

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
    redisCache: Redis;
    queues: typeof queues;
  }

  interface FastifyRequest {
    restaurantId: string;
    userId?: string | null;
    rawBody?: string | Buffer;
  }
}

export {};
