import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import Fastify from 'fastify';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/node';
import { db } from './shared/db/client';
import { redisCache } from './shared/redis/client';
import { queues } from './shared/queue/queues';
import { telnyxVoiceRoutes } from './modules/voice/telnyx.pipeline';
import { restaurantRoutes } from './modules/restaurants/restaurant.routes';
import { customerRoutes } from './modules/customers/customer.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { reservationRoutes } from './modules/reservations/reservation.routes';
import { callRoutes } from './modules/calls/call.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { authSyncRoutes } from './modules/auth/auth.routes';
import { googleRoutes } from './modules/integrations/google.routes';
import { testRoutes } from './modules/test/test.routes';
import { registerCors } from './plugins/cors';
import { registerRateLimit } from './plugins/rate-limit';
import { registerClerk } from './plugins/clerk';
import fastifyWebsocket from '@fastify/websocket';
import { registerMediaStreamRoutes } from './modules/voice/stream/handler';
import { initFillerCache } from './modules/voice/stream/fillers-cache';
import './shared/queue/workers/evening-report.worker';
import './shared/queue/workers/sms-confirmation.worker';
import './shared/queue/workers/outbound-confirm.worker';
import './shared/queue/workers/analytics.worker';
import './shared/queue/workers/reengagement.worker';

export async function buildApp() {
  const app = Fastify({ logger: true });

  app.decorate('db', db);
  app.decorate('redisCache', redisCache);
  app.decorate('queues', queues);

  // Preserve raw body for webhook signature verification (Telnyx signs the
  // exact bytes received — re-serializing JSON can change key order and
  // invalidate the signature). The raw body is exposed as `request.rawBody`.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    (req as any).rawBody = body;
    try {
      const json = body.length === 0 ? null : JSON.parse(body);
      done(null, json);
    } catch (err: any) {
      done(err as Error, undefined);
    }
  });

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
    const statusCode = (err as any).statusCode ?? 500;

    if (statusCode >= 500) {
      request.server.log.error({ err: error, path: request.url }, 'Unhandled error');
    } else {
      request.server.log.warn(
        { err: error, path: request.url, statusCode },
        'Handled client error',
      );
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

  await registerCors(app);
  await registerRateLimit(app);
  await registerClerk(app);
  await app.register(fastifyWebsocket);
  registerMediaStreamRoutes(app);

  await app.register(telnyxVoiceRoutes);
  await app.register(restaurantRoutes);
  await app.register(customerRoutes);
  await app.register(analyticsRoutes);
  await app.register(reservationRoutes);
  await app.register(callRoutes);
  await app.register(dashboardRoutes);
  await app.register(authSyncRoutes);
  await app.register(googleRoutes);

  // Routes de test — uniquement en dev/test (simulation d'appel sans Telnyx)
  if (process.env.NODE_ENV !== 'production') {
    await app.register(testRoutes);
  }

  app.get('/health', async (_req, reply) => {
    const result = await checkHealth(app);
    return reply.status(result.status === 'ok' ? 200 : 503).send(result);
  });

  // Alias K8s-style : /healthz (même handler)
  app.get('/healthz', async (_req, reply) => {
    const result = await checkHealth(app);
    return reply.status(result.status === 'ok' ? 200 : 503).send(result);
  });

  // Liveness probe (toujours OK si le process tourne, sans check DB/Redis)
  app.get('/livez', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });

  return app;
}

async function checkHealth(app: any) {
  const dbStatus: 'ok' | 'error' = await db.$queryRaw`SELECT 1`
    .then((): 'ok' => 'ok')
    .catch((): 'error' => 'error');

  const redisStatus: 'ok' | 'error' = await redisCache
    .ping()
    .then((): 'ok' => 'ok')
    .catch((): 'error' => 'error');

  // Vérifier que les queues BullMQ sont connectées (test actif via getJobCounts)
  let workersStatus: 'ok' | 'error' = 'ok';
  const queueErrors: string[] = [];
  try {
    const queues = app.queues as
      | Record<string, { getJobCounts?: () => Promise<unknown> }>
      | undefined;
    if (queues) {
      await Promise.all(
        Object.entries(queues).map(async ([name, queue]) => {
          try {
            if (typeof queue?.getJobCounts === 'function') {
              await Promise.race([
                queue.getJobCounts(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
              ]);
            }
          } catch (err) {
            workersStatus = 'error';
            queueErrors.push(`${name}: ${(err as Error).message}`);
          }
        }),
      );
    }
  } catch {
    workersStatus = 'error';
  }

  const allOk = dbStatus === 'ok' && redisStatus === 'ok' && workersStatus === 'ok';
  return {
    status: allOk ? 'ok' : 'degraded',
    db: dbStatus,
    redis: redisStatus,
    workers: workersStatus,
    ...(queueErrors.length > 0 && { queueErrors }),
    timestamp: new Date().toISOString(),
  };
}

async function start() {
  const app = await buildApp();

  // Initialisation Sentry (silent si SENTRY_DSN absent)
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
    });
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => app.log.error({ err }, 'SIGTERM shutdown failed'));
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => app.log.error({ err }, 'SIGINT shutdown failed'));
  });

  app.listen({ port: 4000, host: '0.0.0.0' }, (err) => {
    if (err) {
      app.log.error(err);
      app.log.warn('Failed to listen on port 4000 — will exit gracefully for PM2 restart');
      process.exitCode = 1;
      return;
    }
  });

  // Warm-up Cartesia TTS au boot : pré-génère les fillers ET chauffe le modèle
  // vocal Sonic 3.5 (évite le cold start de ~600ms sur le premier appel vocal).
  // Fire-and-forget : on n'attend pas la fin avant d'écouter les requêtes HTTP.
  setImmediate(() => {
    initFillerCache().catch((err) => {
      app.log.warn({ err }, 'Filler cache warmup failed (non-blocking)');
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
      } catch (err) {
        app.log.error(err, 'Failed to register schedulers on startup');
      }
    })().catch((err) => app.log.error({ err }, 'Startup scheduler IIFE failed'));
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

if (!process.env.VITEST) {
  // start() returns a Promise we don't await — the function logs its own
  // errors and Fastify's listen() callback handles boot failures.
  start().catch((err) => console.error('[start] failed:', err));
}
