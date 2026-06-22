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
      req.restaurantId = 'test-rest-1';
      req.userId = 'test-user-1';
    };
  },
  requireAuth: () => {
    return async (req: any, reply: any) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      req.userId = 'test-user-1';
    };
  },
}));

// db mock — contains all Prisma models used by tests.
// We split $transaction's tx from the top-level db to avoid the
// "object literal cannot have multiple properties with the same name"
// TS error that would happen if `restaurant` appeared both at top
// level and inside the transaction callback argument.
vi.mock('../shared/db/client', () => {
  const txMock = {
    restaurant: { update: vi.fn() },
    restaurantExposureSettings: { upsert: vi.fn() },
    reservationAuditLog: { create: vi.fn() },
    reservation: { count: vi.fn() },
    agentClient: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    db: {
      restaurant: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      agentPersonality: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      agentClient: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      restaurantExposureSettings: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      reservationAuditLog: {
        create: vi.fn(),
      },
      reservation: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      customer: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      call: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        delete: vi.fn(),
      },
      latencyTrace: {
        findMany: vi.fn(),
      },
      customerConsent: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: any) => fn(txMock)),
    },
  };
});

vi.mock('../shared/redis/client', () => ({
  redisCache: {
    get: vi.fn().mockResolvedValue(null),
    getBuffer: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    status: 'ready',
  },
  redisQueue: {
    on: vi.fn(),
  },
  getCachedContext: vi.fn().mockResolvedValue(null),
  setCachedContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shared/queue/queues', () => ({
  queues: {
    eveningReport: {
      upsertJobScheduler: vi.fn(),
    },
    onboarding: {
      add: vi.fn(),
    },
    reconciliation: {
      upsertJobScheduler: vi.fn(),
    },
    smsManager: {
      add: vi.fn(),
    },
    telnyxWebhooks: {
      add: vi.fn(),
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
