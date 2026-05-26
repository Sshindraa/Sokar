import { buildApp } from '../main';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

vi.mock('../plugins/clerk', () => ({
  registerClerk: vi.fn().mockResolvedValue(undefined),
  requireOrg: () => {
    return async (req: any, reply: any) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      (req as any).restaurantId = 'test-rest-1';
      (req as any).userId = 'test-user-1';
    };
  },
  requireAuth: () => {
    return async (req: any, reply: any) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      (req as any).userId = 'test-user-1';
    };
  },
}));

vi.mock('../shared/db/client', () => ({
  db: {
    restaurant: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    agentPersonality: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../shared/redis/client', () => ({
  redisCache: {
    del: vi.fn(),
  },
  redisQueue: {
    on: vi.fn(),
  },
}));

vi.mock('../shared/queue/queues', () => ({
  queues: {
    eveningReport: {
      upsertJobScheduler: vi.fn(),
    },
  },
}));

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
}
