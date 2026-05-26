import Fastify               from 'fastify';
import { ZodError }          from 'zod';
import * as Sentry           from '@sentry/node';
import { db }                from './shared/db/client';
import { redisCache }        from './shared/redis/client';
import { queues }            from './shared/queue/queues';
import { telnyxVoiceRoutes } from './modules/voice/telnyx.pipeline';
import { restaurantRoutes }  from './modules/restaurants/restaurant.routes';
import { customerRoutes }    from './modules/customers/customer.routes';
import { analyticsRoutes }   from './modules/analytics/analytics.routes';
import { reservationRoutes } from './modules/reservations/reservation.routes';
import { callRoutes }        from './modules/calls/call.routes';
import { dashboardRoutes }   from './modules/dashboard/dashboard.routes';
import { authSyncRoutes }    from './modules/auth/auth.routes';
import { testRoutes }        from './modules/test/test.routes';
import { registerCors }      from './plugins/cors';
import { registerRateLimit } from './plugins/rate-limit';
import { registerClerk }     from './plugins/clerk';
import { registerMediaStreamRoutes } from './modules/voice/stream/handler';
import { initFillerCache } from './modules/voice/stream/fillers-cache';
import './shared/queue/workers/evening-report.worker';
import './shared/queue/workers/sms-confirmation.worker';
import './shared/queue/workers/outbound-confirm.worker';

export async function buildApp() {
  const app = Fastify({ logger: true });

  app.decorate('db',         db);
  app.decorate('redisCache', redisCache);
  app.decorate('queues',     queues);

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

    // Toujours logger le détail côté serveur
    request.server.log.error({ err: error, path: request.url }, 'Unhandled error');

    const err = error as Error;
    const statusCode = (err as any).statusCode ?? 500;
    reply.status(statusCode).send({
      error: err.name ?? 'InternalServerError',
      message:
        process.env.NODE_ENV === 'production'
          ? 'Une erreur interne est survenue.'
          : err.message,
      statusCode,
    });
  });

  await registerCors(app);
  await registerRateLimit(app);
  await registerClerk(app);

  await app.register(telnyxVoiceRoutes);
  await app.register(restaurantRoutes);
  await app.register(customerRoutes);
  await app.register(analyticsRoutes);
  await app.register(reservationRoutes);
  await app.register(callRoutes);
  await app.register(dashboardRoutes);
  await app.register(authSyncRoutes);

  // Routes de test — uniquement en dev/test (simulation d'appel sans Telnyx)
  if (process.env.NODE_ENV !== 'production') {
    await app.register(testRoutes);
  }

  // WebSocket plugin + media stream routes (flux pipeline)
  await app.register(import('@fastify/websocket'));
  registerMediaStreamRoutes(app);

  // Init filler cache (pré-génération des fillers audio)
  await initFillerCache();

  app.get('/health', async (_req, reply) => {
    let dbStatus = 'ok', redisStatus = 'ok';
    try { await db.$queryRaw`SELECT 1`; }  catch { dbStatus    = 'error'; }
    try { await redisCache.ping(); }        catch { redisStatus = 'error'; }
    return reply.send({
      status: dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
      db: dbStatus, redis: redisStatus,
    });
  });

  return app;
}

async function start() {
  const app = await buildApp();

  // Initialisation Sentry (silent si SENTRY_DSN absent)
  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' });
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  app.listen({ port: 4000, host: '0.0.0.0' }, (err) => {
    if (err) { app.log.error(err); process.exit(1); }
  });

  setImmediate(async () => {
    try {
      const restaurants = await db.restaurant.findMany({ select: { id: true } });
      for (const r of restaurants) {
        await queues.eveningReport.upsertJobScheduler(
          `nightly-${r.id}`,
          { pattern: '0 23 * * *', tz: 'Europe/Paris' },
          { name: 'nightly', data: { restaurantId: r.id } }
        );
      }
    } catch (err) {
      app.log.error(err, 'Failed to register schedulers on startup');
    }
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

if (!process.env.VITEST) {
  start();
}
