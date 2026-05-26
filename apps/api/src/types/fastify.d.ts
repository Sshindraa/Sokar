import type { db }           from '../shared/db/client';
import type { queues }       from '../shared/queue/queues';

declare module 'fastify' {
  interface FastifyInstance {
    db:       typeof db;
    redisCache: any;
    queues:   typeof queues;
  }
}

export {};
