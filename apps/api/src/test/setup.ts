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
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    };
    giftCardContribution = {
      create: vi.fn(),
      findMany: vi.fn(),
    };
    giftCardPack = {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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
  sendWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock Stripe (SDK non nécessaire en tests unitaires) ──
vi.mock('stripe', () => {
  class Stripe {
    paymentIntents = {
      create: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'pi_t_s' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'pi_test', status: 'succeeded' }),
    };
    webhooks = {
      constructEvent: vi.fn().mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test', status: 'succeeded' } },
      }),
    };
  }
  return { default: Stripe };
});

// ── Mock stripe.service (fonctions mockables par les tests) ──
vi.mock('../modules/gift-cards/stripe.service', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', clientSecret: 'pi_t_s' }),
    retrievePaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', status: 'succeeded' }),
    constructWebhookEvent: vi.fn().mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', status: 'succeeded' } },
    }),
  };
});

// ── Mock rate-limit (Redis non requis en tests unitaires) ──
vi.mock('../shared/redis/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  rateLimitKey: (route: string, ip: string) => `ratelimit:${route}:${ip}`,
  getClientIp: (req: { ip?: string; headers?: Record<string, string | string[]> }) =>
    req.ip ?? req.headers?.['x-forwarded-for'] ?? 'test-ip',
}));

// ── Mock gift-card-code.util (shortCode fixe en tests) ──
vi.mock('../modules/gift-cards/gift-card-code.util', () => ({
  generateShortCode: vi.fn(() => 'SKR-TEST-01'),
  generateUniqueShortCode: vi.fn().mockResolvedValue('SKR-TEST-01'),
}));

// ── Mock gift-card-email.service (emails non envoyés en tests) ──
vi.mock('../modules/gift-cards/gift-card-email.service', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendSenderReceipt: vi.fn().mockResolvedValue(undefined),
    sendRecipientGiftCard: vi.fn().mockResolvedValue(undefined),
    sendRestaurantSaleNotification: vi.fn().mockResolvedValue(undefined),
    sendContributionConfirmation: vi.fn().mockResolvedValue(undefined),
    sendCrowdfundingContributionNotification: vi.fn().mockResolvedValue(undefined),
    sendCrowdfundingClosed: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Mock gift-card-whatsapp.service (WhatsApp non envoyé en tests) ──
vi.mock('../modules/gift-cards/gift-card-whatsapp.service', () => ({
  sendRecipientWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock pdfkit (génération PDF non nécessaire en tests unitaires) ──
vi.mock('pdfkit', () => {
  class PDFDocument {
    page = { width: 297, height: 420 }; // A6 approx
    private handlers: Record<string, ((chunk?: unknown) => void)[]> = {};
    constructor(_opts?: unknown) {}
    pipe = vi.fn();
    fontSize = vi.fn().mockReturnThis();
    font = vi.fn().mockReturnThis();
    text = vi.fn().mockReturnThis();
    image = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    fill = vi.fn().mockReturnThis();
    fillColor = vi.fn().mockReturnThis();
    strokeColor = vi.fn().mockReturnThis();
    moveTo = vi.fn().mockReturnThis();
    lineTo = vi.fn().mockReturnThis();
    stroke = vi.fn().mockReturnThis();
    moveDown = vi.fn().mockReturnThis();
    lineWidth = vi.fn().mockReturnThis();
    on(event: string, cb: (chunk?: unknown) => void) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(cb);
      return this;
    }
    end() {
      if (this.handlers['data']) {
        for (const cb of this.handlers['data']) cb(Buffer.from('mock-pdf'));
      }
      if (this.handlers['end']) {
        for (const cb of this.handlers['end']) cb();
      }
    }
  }
  return { default: PDFDocument };
});

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
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_t';
process.env.SMTP_HOST ??= 'localhost';
process.env.SMTP_PORT ??= '465';
process.env.SMTP_USER ??= 'test';
process.env.SMTP_PASS ??= 'test';
process.env.EMAIL_FROM ??= 'noreply@test.sokar.fr';
// Active explicitement les routes /api/test dans les tests (SEC-005).
process.env.ENABLE_TEST_ROUTES = 'true';
