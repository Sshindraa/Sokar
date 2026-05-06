import Fastify               from 'fastify';
import { db }                from './shared/db/client';
import { redisCache }        from './shared/redis/client';
import { queues }            from './shared/queue/queues';
import { voiceRoutes }       from './modules/voice/pipeline';
import { telnyxVoiceRoutes } from './modules/voice/telnyx.pipeline';
import { restaurantRoutes }  from './modules/restaurants/restaurant.routes';
import { customerRoutes }    from './modules/customers/customer.routes';
import { analyticsRoutes }   from './modules/analytics/analytics.routes';
import { toNodeHandler }     from 'better-auth/node';
import { auth }              from './lib/auth';
import { registerCors }      from './plugins/cors';
import { registerRateLimit } from './plugins/rate-limit';
import './shared/queue/workers/evening-report.worker';
import './shared/queue/workers/sms-confirmation.worker';
import './shared/queue/workers/outbound-confirm.worker';

export async function buildApp() {
  const app = Fastify({ logger: true });

  app.decorate('db',     db);
  app.decorate('queues', queues);

  await registerCors(app);
  await registerRateLimit(app);

  await app.register(voiceRoutes);
  await app.register(telnyxVoiceRoutes);
  await app.register(restaurantRoutes);
  await app.register(customerRoutes);
  await app.register(analyticsRoutes);

  await app.register(async (instance) => {
    instance.route({
      method:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      url:     '/auth/*',
      handler: async (req, reply) => {
        const handler = toNodeHandler(auth);
        await handler(req.raw, reply.raw);
        reply.hijack();
      },
    });
  });

  app.get('/health', async (_req, reply) => {
    let dbStatus = 'ok', redisStatus = 'ok';
    try { await db.$queryRaw`SELECT 1`; }  catch { dbStatus    = 'error'; }
    try { await redisCache.ping(); }        catch { redisStatus = 'error'; }
    return reply.send({
      status: dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
      db: dbStatus, redis: redisStatus, telnyx: process.env.TELNYX_API_KEY ? 'client_initialized' : 'not_configured',
    });
  });

  return app;
}

async function start() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  app.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
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

if (!process.env.VITEST) {
  start();
}
