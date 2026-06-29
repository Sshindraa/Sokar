import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { db } from '../../db/client';

/**
 * Handler de la queue `analytics` (partagée entre onboarding et RGPD).
 * Exporté pour test unitaire — le worker BullMQ l'appelle via cette fn.
 *
 * Events onboarding (`onboarding_*`) : persistés en base dans
 * `onboarding_events` pour permettre l'analyse de funnel (drop-offs par
 * étape). Si l'insertion échoue, on throw pour déclencher le retry BullMQ
 * (5 attempts, backoff exponentiel).
 *
 * Events RGPD (`rgpd_*`) : log uniquement. La preuve légale reste dans
 * `ReservationAuditLog` ; ces events sont pour l'observabilité temps réel.
 */
export async function processAnalyticsJob(job: Job): Promise<void> {
  const log = jobLogger(job);
  const { event, restaurantId, userId, task, metadata, createdAt } = job.data;

  if (typeof event === 'string' && event.startsWith('onboarding_')) {
    await db.onboardingEvent.create({
      data: {
        restaurantId,
        userId: userId ?? null,
        event,
        task: task ?? null,
        metadata: metadata ?? {},
        createdAt: createdAt ? new Date(createdAt) : new Date(),
      },
    });
    log.info({ event, restaurantId, task }, '[analytics] onboarding event persisted');
    return;
  }

  // RGPD et autres events : log uniquement
  log.info({ event: job.data }, '[analytics] event logged');
}

export const analyticsWorker = new Worker('analytics', processAnalyticsJob, {
  connection: redisQueue,
});

setupWorkerListeners(analyticsWorker);
