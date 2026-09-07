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
    /** Historical alias for the active establishment ID. */
    siteId?: string;
    /** Internal Sokar account ID when the multi-site backfill is active. */
    accountId?: string;
    clerkOrganizationId?: string;
    siteRole?: 'OWNER' | 'MANAGER' | 'STAFF' | 'READ_ONLY' | 'ORG_MEMBER';
    userId?: string | null;
    rawBody?: string | Buffer;
  }
}

export {};
