import { buildApp } from '../main';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

vi.mock('../plugins/clerk', () => ({
  isClerkConfigured: vi.fn(() => true),
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
    restaurantExposureSettings: { upsert: vi.fn(), findUnique: vi.fn() },
    reservationAuditLog: { create: vi.fn() },
    reservation: { count: vi.fn() },
    agentClient: {
      create: vi.fn(),
      update: vi.fn(),
    },
    floorPlan: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    section: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    table: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reactivationCampaign: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    giftCard: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({ id: 'tx-card' }),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
    },
    giftCardRedemption: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    giftCardContribution: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    giftCardPack: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  const dbObj = {
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
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    reservationAuditLog: {
      create: vi.fn(),
    },
    reservation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    customer: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    call: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
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
    agenticHold: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    restaurantImage: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    onboardingEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'test-evt-1' }),
    },
    floorPlan: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    section: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    table: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reactivationCampaign: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    giftCard: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    giftCardRedemption: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    giftCardContribution: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    giftCardPack: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (fn: any) => {
      if (Array.isArray(fn)) {
        return Promise.all(fn);
      }
      // Fusionner txMock avec db : pour chaque modèle, on crée un proxy
      // qui préfère les mocks définis sur db (où les tests font vi.mocked)
      // mais retombe sur txMock pour les modèles uniquement dans txMock.
      const mergedTx = new Proxy({} as Record<string, unknown>, {
        get: (_target, prop) => {
          const propStr = prop as string;
          const dbModel = (dbObj as Record<string, unknown>)[propStr];
          if (dbModel !== undefined) return dbModel;
          const txModel = (txMock as Record<string, unknown>)[propStr];
          if (txModel !== undefined) return txModel;
          return undefined;
        },
      });
      return fn(mergedTx);
    }),
  };

  return { db: dbObj };
});

vi.mock('../shared/redis/client', () => {
  // In-memory Map pour que les tests OAuth puissent faire set→get.
  // Les tests existants qui font get sans set auront toujours null (comportement inchangé).
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    redisCache: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      getBuffer: vi.fn().mockResolvedValue(null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        const had = store.has(key);
        store.delete(key);
        return had ? 1 : 0;
      }),
      flushall: vi.fn(async () => {
        store.clear();
        counters.clear();
        return 'OK';
      }),
      // Rate limiter support (McpRateLimiter + connect-rate-limit)
      script: vi.fn(async () => 'mock-sha1'),
      evalsha: vi.fn(async () => [1, 59, 0] as [number, number, number]),
      incr: vi.fn(async (key: string) => {
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        return count;
      }),
      expire: vi.fn(async () => 1),
      // Used by OAuth checkOauthRate for atomic INCR + PEXPIRE
      eval: vi.fn(async (_script: string, _numKeys: number, key: string) => {
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        return count;
      }),
      status: 'ready',
    },
    redisQueue: {
      on: vi.fn(),
    },
    getCachedContext: vi.fn().mockResolvedValue(null),
    setCachedContext: vi.fn().mockResolvedValue(undefined),
  };
});

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
    callRecovery: {
      add: vi.fn().mockResolvedValue({}),
    },
    telnyxWebhooks: {
      add: vi.fn(),
    },
    analytics: {
      add: vi.fn().mockResolvedValue({}),
    },
    connectAnalytics: {
      add: vi.fn().mockResolvedValue({}),
    },
    confirmationSms: {
      add: vi.fn().mockResolvedValue({}),
    },
    reactivation: {
      add: vi.fn().mockResolvedValue({}),
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
