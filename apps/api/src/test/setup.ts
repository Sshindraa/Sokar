import { vi } from 'vitest';

// ── Mock @prisma/client ──
vi.mock('@prisma/client', () => {
  class PrismaClient {
    restaurant = {
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
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
    $queryRaw = vi.fn().mockResolvedValue([{ '1': 1 }]);
    $disconnect = vi.fn();
  }
  return { PrismaClient };
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
process.env.DATABASE_URL = 'postgresql://test:***@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
process.env.TZ = 'Europe/Paris';
process.env.TELNYX_API_KEY = 'test-telnyx-key';
process.env.TELNYX_WEBHOOK_SECRET = 'test-telnyx-secret';
process.env.TELNYX_FROM_NUMBER = '+331****0000';
process.env.TTS_CACHE_ENABLED = 'false';
process.env.VIP_PUSH_ENABLED = 'false';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_dummy-test-key';
process.env.CLERK_SECRET_KEY = 'sk_test_dummy-secret-key';
process.env.OPENROUTER_API_KEY = 'sk-or-test';
process.env.CARTESIA_API_KEY = 'test-cartesia-key';
