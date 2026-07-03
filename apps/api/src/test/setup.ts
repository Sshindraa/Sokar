import { vi } from 'vitest';

// ── Mock @prisma/client ──
vi.mock('@prisma/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class PrismaClient {
    restaurant = {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    giftCard = {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    };
    call = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    reservation = {
      findMany: vi.fn(),
      create: vi.fn(),
    };
    onboardingEvent = {
      create: vi.fn().mockResolvedValue({ id: 'test-evt-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    $queryRaw = vi.fn().mockResolvedValue([{ '1': 1 }]);
    $disconnect = vi.fn();
  }
  return {
    ...actual, // preserve Prisma namespace (PrismaClientKnownRequestError, Prisma.JsonNull, etc.)
    PrismaClient,
  };
});

// ── Mock ioredis ──
vi.mock('ioredis', () => {
  class Redis {
    get = vi.fn();
    set = vi.fn();
    del = vi.fn();
    incr = vi.fn().mockResolvedValue(1);
    expire = vi.fn().mockResolvedValue(1);
    ping = vi.fn().mockResolvedValue('PONG');
    quit = vi.fn();
  }
  return { default: Redis };
});

// ── Mock BullMQ ──
vi.mock('bullmq', () => {
  class Queue {
    add = vi.fn().mockResolvedValue({});
    upsertJobScheduler = vi.fn().mockResolvedValue({});
  }
  class Worker {
    on = vi.fn();
    close = vi.fn();
  }
  return { Queue, Worker };
});

// ── Mock Sentry ──
vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  init: vi.fn(),
  close: vi.fn(),
  setupFastifyErrorHandler: vi.fn(),
}));

// ── Mock nodemailer ──
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({}),
    })),
  },
}));

// ── Mock telnyx (SDK CJS, non compatible ESM via vitest) ──
vi.mock('telnyx', () => ({
  createTelnyx: () => ({
    messages: { create: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock('../../shared/telnyx/client', () => ({
  default: {
    messages: { create: vi.fn().mockResolvedValue({}) },
  },
  sendSms: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock lib/auth — valeur par défaut (surchargeable par les fichiers de test) ──
vi.mock('../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

// ── Set test env vars ──
// DATABASE_URL par défaut : la DB locale sokar (Postgres brew).
// Surchargeable via env si besoin (CI, autre host).
process.env.DATABASE_URL ??= 'postgresql://sokar:***@localhost:5432/sokar';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
process.env.TZ = 'Europe/Paris';
// URL vars requises par le schéma Zod de env.ts (validation centralisée).
// Valeurs localhost pour les tests — le .refine() prod allowlist ne s'active
// qu'en NODE_ENV=production.
process.env.PUBLIC_URL ??= 'http://localhost:4000';
process.env.SITE_URL ??= 'http://localhost:4002';
process.env.DASHBOARD_URL ??= 'http://localhost:3000';
process.env.API_URL ??= 'http://localhost:4000';
process.env.TELNYX_API_KEY = 'test-telnyx-key';
process.env.TELNYX_WEBHOOK_SECRET = 'test-telnyx-secret';
process.env.TELNYX_FROM_NUMBER = '+331****0000';
process.env.TTS_CACHE_ENABLED = 'false';
process.env.VIP_PUSH_ENABLED = 'false';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_dummy-test-key';
process.env.CLERK_SECRET_KEY = 'sk_test_dummy-secret-key';
process.env.OPENROUTER_API_KEY = 'sk-or-test';
process.env.CARTESIA_API_KEY = 'test-cartesia-key';
