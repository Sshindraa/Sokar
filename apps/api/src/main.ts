import { env } from './env';

import { initSentry, captureException, closeSentry } from './shared/sentry/client';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { setupFastifyErrorHandler } from '@sentry/node';
import { db } from './shared/db/client';
import { redisCache } from './shared/redis/client';
import { queues } from './shared/queue/queues';
import { logger, newRequestId } from './shared/logger/pino';
import { telnyxVoiceRoutes } from './modules/voice/telnyx.pipeline';
import { smsInboundRoutes } from './modules/sms/sms-inbound.routes';
import { whatsappWebhookRoutes } from './modules/whatsapp/whatsapp-webhook.routes';
import { restaurantRoutes } from './modules/restaurants/restaurant.routes';
import { customerRoutes } from './modules/customers/customer.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { reservationRoutes } from './modules/reservations/reservation.routes';
import { callRoutes } from './modules/calls/call.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { reactivationRoutes } from './modules/dashboard/reactivation.routes';
import { authSyncRoutes } from './modules/auth/auth.routes';
import { googleRoutes } from './modules/integrations/google.routes';
import { testRoutes } from './modules/test/test.routes';
import { agenticAdminRoutes } from './modules/agentic-reservations/admin/admin.routes';
import { mcpRoutes } from './modules/agentic-reservations/mcp/server';
import { oauthRoutes } from './modules/agentic-reservations/mcp/oauth';
import { openaiReserveRoutes } from './modules/agentic-reservations/openai-reserve/openai-reserve.routes';
import { rgpdRoutes } from './modules/rgpd/rgpd.routes';
import { observabilityRoutes } from './shared/observability/observability.routes';
import { httpRequestsTotal } from './shared/observability/metrics';
import { connectRoutes } from './modules/connect/connect.routes';
import { floorPlanRoutes } from './modules/floor-plan/floor-plan.routes';
import { giftCardRoutes } from './modules/gift-cards/gift-card.routes';
import { giftCardPackRoutes } from './modules/gift-cards/gift-card-pack.routes';
import { pilotRoutes } from './modules/pilot/pilot.routes';
import { flagsRoutes } from './modules/admin/flags.routes';
import { onboardingFunnelRoutes } from './modules/admin/onboarding-funnel.routes';
import { registerCors } from './plugins/cors';
import { registerRateLimit } from './plugins/rate-limit';
import { registerClerk } from './plugins/clerk';
import fastifyWebsocket from '@fastify/websocket';
import { registerMediaStreamRoutes } from './modules/voice/stream/handler';
import { initFillerCache } from './modules/voice/stream/fillers-cache';
import { checkHealth } from './shared/health/checks';
import './shared/queue/workers/evening-report.worker';
import './shared/queue/workers/sms-confirmation.worker';
import './shared/queue/workers/outbound-confirm.worker';
import './shared/queue/workers/analytics.worker';
import './shared/queue/workers/reengagement.worker';
import './shared/queue/workers/reconciliation.worker';
import './shared/queue/workers/telnyx-webhook.worker';
import './shared/queue/workers/call-recovery.worker';
import './shared/queue/workers/connect-analytics.worker';
import './shared/queue/workers/confirmation-sms.worker';
import './shared/queue/workers/reactivation.worker';
import './shared/queue/workers/google-places-sync.worker';
import './shared/queue/workers/alert-evaluation.worker';
import './modules/agentic-reservations/workers/expire-hold.worker';
import './modules/agentic-reservations/workers/expire-quote.worker';

// Initialize Sentry as early as possible so that instrumentation hooks are
// registered before the Fastify app (and its error handler) are built.
initSentry();

export async function buildApp() {
  const isDev = process.env.NODE_ENV !== 'production';

  // Use Fastify's default Pino logger (it already creates a Pino instance
  // with sane defaults). We provide a `childLoggerFactory` so every request's
  // child logger is enriched with `request_id` — and honours an inbound
  // `x-request-id` header for end-to-end correlation across services.
  //
  // Our shared `logger` instance (imported above) is used by the application
  // code (startup, shutdown, workers, etc.). Fastify's request-scoped
  // loggers are children of the Fastify internal Pino instance. They share
  // the same redaction patterns via the options below.
  //
  // The `as never` cast on `logger`: Fastify 5's type inference for the
  // options object narrows the logger type to `never` when a child logger
  // factory is provided. The runtime value is correct (Pino options), this
  // only restores the right type at compile time.
  const trustedProxyIps = env.TRUSTED_PROXY_IPS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const app = Fastify({
    // Nginx et le dashboard Next.js proxy sont les seuls reverse proxies.
    // Nécessaire pour que req.ip reflète le vrai client (X-Forwarded-For)
    // et que le rate-limit global s'applique par utilisateur, pas par 127.0.0.1.
    trustProxy: trustedProxyIps,
    logger: {
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      base: { service: 'sokar-api', env: process.env.NODE_ENV ?? 'development' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.secret',
          '*.apiKey',
          '*.api_key',
          '*.token',
          'env.SENTRY_DSN',
          'env.CLERK_SECRET_KEY',
          'env.OPENROUTER_API_KEY',
          'env.CARTESIA_API_KEY',
          'env.TELNYX_API_KEY',
          'env.TELNYX_PUBLIC_KEY',
          'env.GOOGLE_PLACES_API_KEY',
        ],
        censor: '[REDACTED]',
      },
    } as never,
    childLoggerFactory: (loggerInstance, bindings, _opts, rawReq) => {
      const headerId = (rawReq as { headers?: Record<string, unknown> }).headers?.['x-request-id'];
      const headerStr = Array.isArray(headerId) ? headerId[0] : headerId;
      const requestId =
        typeof headerStr === 'string' && headerStr.length > 0 ? headerStr : newRequestId();
      bindings.request_id = requestId;
      // Stash on the raw request so the onRequest hook / handlers can read it.
      (rawReq as { requestId?: string }).requestId = requestId;
      return loggerInstance.child(bindings);
    },
    // Versioning des endpoints publics Connect (Phase 6) :
    // /public/v1/* est un alias de /public/* (transition progressive).
    // rewriteUrl s'exécute AVANT le routing Fastify (contrairement à un hook
    // onRequest, qui s'exécute après que la route a été matchée — trop tard).
    // Cf. https://fastify.dev/docs/latest/Reference/Server/#rewriteurl
    rewriteUrl(req) {
      const url = req.url ?? '/';
      if (url.startsWith('/public/v1/')) {
        return `/public/${url.slice('/public/v1/'.length)}`;
      }
      return url;
    },
  });

  // Stamp every incoming request with a request_id (set by childLoggerFactory
  // above). The request's logger (`req.log`) is a child of the base logger
  // that automatically includes this id on every log line for that request.
  // To trace a request end-to-end in production logs, grep for the request_id.
  app.addHook('onRequest', (request, _reply, done) => {
    // childLoggerFactory already attached requestId; this hook is a no-op
    // kept for documentation and future per-request setup.
    done();
  });

  // Global HTTP request counter — alimente alertErrorRateHigh via le worker
  // alert-evaluation. Exécuté après toutes les routes (y compris 404).
  app.addHook('onResponse', (request, reply, done) => {
    const code = reply.statusCode;
    const statusClass = code < 400 ? '2xx' : code < 500 ? '4xx' : '5xx';
    httpRequestsTotal.inc({ status_class: statusClass });
    done();
  });

  app.decorate('db', db);
  app.decorate('redisCache', redisCache);
  app.decorate('queues', queues);

  // Preserve raw body for webhook signature verification (Telnyx signs the
  // exact bytes received — re-serializing JSON can change key order and
  // invalidate the signature). The raw body is exposed as `request.rawBody`.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    (req as { rawBody?: string }).rawBody = body;
    try {
      const json = body.length === 0 ? null : JSON.parse(body);
      done(null, json);
    } catch (err: unknown) {
      done(err as Error, undefined);
    }
  });

  // OAuth 2.0 endpoints (token, register) reçoivent du form-urlencoded.
  // @fastify/formbody gère tous les edge cases d'encodage (notamment + → espace).
  // Ne jamais remplacer par un parser custom — c'est comme ça qu'on a eu le bug
  // des scopes collés ("mcp:read+mcp:reserve+mcp:cancel" au lieu de 3 séparés).
  await app.register(import('@fastify/formbody'));

  // Global error handler — Zod validation errors → 400 propre
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    const err = error as Error;
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error, path: request.url }, 'Unhandled error');
      captureException(error, {
        extra: { path: request.url, method: request.method, requestId: request.id },
        tags: { route: request.url },
      });
    } else {
      request.log.warn({ err: error, path: request.url, statusCode }, 'Handled client error');
    }

    reply.status(statusCode).send({
      error: err.name ?? 'InternalServerError',
      message:
        process.env.NODE_ENV === 'production' && statusCode >= 500
          ? 'Une erreur interne est survenue.'
          : err.message,
      statusCode,
    });
  });

  // Install the Sentry Fastify error handler *after* our custom handler so it
  // wraps and augments it. Sentry will send 500s to its own backend as well.
  setupFastifyErrorHandler(app);

  await registerCors(app);
  await registerRateLimit(app);
  await registerClerk(app);
  await app.register(fastifyWebsocket);
  registerMediaStreamRoutes(app);

  await app.register(telnyxVoiceRoutes);
  await app.register(smsInboundRoutes);
  await app.register(whatsappWebhookRoutes);
  await app.register(restaurantRoutes);
  await app.register(customerRoutes);
  await app.register(analyticsRoutes);
  await app.register(reservationRoutes);
  await app.register(callRoutes);
  await app.register(dashboardRoutes);
  await app.register(reactivationRoutes);
  await app.register(authSyncRoutes);
  await app.register(googleRoutes);
  await app.register(agenticAdminRoutes);
  await app.register(mcpRoutes);
  await app.register(oauthRoutes);
  await app.register(openaiReserveRoutes);
  await app.register(rgpdRoutes);
  await app.register(connectRoutes);
  await app.register(floorPlanRoutes);
  await app.register(giftCardRoutes);
  await app.register(giftCardPackRoutes);
  await app.register(observabilityRoutes);
  await app.register(pilotRoutes);
  await app.register(flagsRoutes);
  await app.register(onboardingFunnelRoutes);

  // Routes de test — uniquement en dev/test (simulation d'appel sans Telnyx)
  if (process.env.NODE_ENV !== 'production') {
    await app.register(testRoutes);
  }

  app.get('/health', async (_req, reply) => {
    const result = await checkHealth();
    // 503 if any core check failed (db/redis/queues).
    // 200 if only voice providers failed (api still serves non-voice).
    const coreOk = ['db', 'redis', 'queues'].every((name) => result.checks[name]?.status === 'ok');
    return reply.status(coreOk ? 200 : 503).send(result);
  });

  // Alias K8s-style : /healthz (même handler)
  app.get('/healthz', async (_req, reply) => {
    const result = await checkHealth();
    const coreOk = ['db', 'redis', 'queues'].every((name) => result.checks[name]?.status === 'ok');
    return reply.status(coreOk ? 200 : 503).send(result);
  });

  // Liveness probe (toujours OK si le process tourne, sans check DB/Redis)
  app.get('/livez', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });

  return app;
}

async function start() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully...');
    await app.close();
    await closeSentry();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => logger.error({ err }, 'SIGTERM shutdown failed'));
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => logger.error({ err }, 'SIGINT shutdown failed'));
  });

  app.listen(
    { port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '0.0.0.0' },
    (err) => {
      if (err) {
        logger.error(err);
        logger.warn('Failed to listen on port 4000 — will exit gracefully for PM2 restart');
        process.exitCode = 1;
        return;
      }
    },
  );

  // Warm-up Cartesia TTS au boot : pré-génère les fillers ET chauffe le modèle
  // vocal Sonic 3.5 (évite le cold start de ~600ms sur le premier appel vocal).
  // Fire-and-forget : on n'attend pas la fin avant d'écouter les requêtes HTTP.
  setImmediate(() => {
    initFillerCache().catch((err) => {
      logger.warn({ err }, 'Filler cache warmup failed (non-blocking)');
    });
  });

  setImmediate(() => {
    (async () => {
      try {
        const restaurants = await db.restaurant.findMany({ select: { id: true } });
        for (const r of restaurants) {
          await queues.eveningReport.upsertJobScheduler(
            `nightly-${r.id}`,
            { pattern: '0 23 * * *', tz: 'Europe/Paris' },
            { name: 'nightly', data: { restaurantId: r.id } },
          );
        }

        await queues.reconciliation.upsertJobScheduler(
          'daily-call-reconciliation',
          { pattern: '20 3 * * *', tz: 'Europe/Paris' },
          {
            name: 'calls',
            data: { kind: 'calls' },
          },
        );
        await queues.reconciliation.upsertJobScheduler(
          'daily-sms-reconciliation',
          { pattern: '35 3 * * *', tz: 'Europe/Paris' },
          {
            name: 'sms',
            data: { kind: 'sms' },
          },
        );

        // SMS de rappel J-1 : envoie les SMS à 17h chaque jour
        await queues.confirmationSms.upsertJobScheduler(
          'daily-confirmation-scan',
          { pattern: '0 17 * * *', tz: 'Europe/Paris' },
          { name: 'confirmation-scan', data: { kind: 'scan' } },
        );

        // Réactivation VIP dormant : scan hebdo le lundi à 10h
        await queues.reactivation.upsertJobScheduler(
          'weekly-vip-reactivation',
          { pattern: '0 10 * * 1', tz: 'Europe/Paris' },
          { name: 'reactivation-scan', data: { kind: 'scan' } },
        );

        // Alert evaluation : toutes les 5 minutes. Lit les métriques Prometheus,
        // compare avec le snapshot précédent (Redis), déclenche les alertes
        // Sentry avec cooldown 30 min. Cf. alert-evaluation.worker.ts.
        await queues.alertEvaluation.upsertJobScheduler(
          'alert-evaluation-5min',
          { pattern: '*/5 * * * *', tz: 'Europe/Paris' },
          { name: 'evaluate-alerts' },
        );
      } catch (err) {
        logger.error(err, 'Failed to register schedulers on startup');
      }
    })().catch((err) => logger.error({ err }, 'Startup scheduler IIFE failed'));
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, '[unhandledRejection]');
});

if (!process.env.VITEST) {
  // start() returns a Promise we don't await — the function logs its own
  // errors and Fastify's listen() callback handles boot failures.
  start().catch((err) => console.error('[start] failed:', err));
}
