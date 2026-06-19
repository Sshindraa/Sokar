import { Worker, type Job } from 'bullmq';
import { logger } from '../../logger/pino';
import * as Sentry from '@sentry/node';

/**
 * Returns a Pino child logger pre-bound with the job's context:
 *   { queue, job_id, job_name, restaurant_id? }
 *
 * Use this at the top of any BullMQ processor so every log line emitted
 * during the job carries the same correlation fields. Example:
 *
 *   export const myWorker = new Worker('my-queue', async (job) => {
 *     const log = jobLogger(job);
 *     log.info('starting work');
 *     // ... do the work, use log instead of logger
 *   });
 *
 * Filter production logs for a single job:
 *   pm2 logs | jq 'select(.job_id == "123")'
 *
 * Filter by queue:
 *   pm2 logs | jq 'select(.queue == "evening-report")'
 */
export function jobLogger(job: Job): ReturnType<typeof logger.child> {
  const data = (job.data ?? {}) as { restaurantId?: string };
  return logger.child({
    queue: job.queueName,
    job_id: job.id,
    job_name: job.name,
    ...(data.restaurantId ? { restaurant_id: data.restaurantId } : {}),
  });
}

export function setupWorkerListeners(worker: Worker) {
  worker.on('failed', (job, err) => {
    logger.error(
      {
        err,
        jobId: job?.id,
        jobName: job?.name,
        queueName: worker.name,
        jobData: job?.data,
      },
      `[Worker:${worker.name}] Job ${job?.id ?? 'unknown'} failed`,
    );

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, {
        tags: {
          queue: worker.name,
          jobId: job?.id,
          jobName: job?.name,
        },
        extra: {
          jobData: job?.data,
        },
      });
    }
  });

  worker.on('error', (err) => {
    logger.error(
      { err, queueName: worker.name },
      `[Worker:${worker.name}] Worker connection/internal error`,
    );
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, {
        tags: {
          queue: worker.name,
          errorType: 'worker-internal',
        },
      });
    }
  });
}
