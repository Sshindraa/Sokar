import { Worker } from 'bullmq';
import { logger } from '../../logger/pino';
import * as Sentry from '@sentry/node';

export function setupWorkerListeners(worker: Worker) {
  worker.on('failed', (job, err) => {
    logger.error({
      err,
      jobId: job?.id,
      jobName: job?.name,
      queueName: worker.name,
      jobData: job?.data,
    }, `[Worker:${worker.name}] Job ${job?.id ?? 'unknown'} failed`);

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
    logger.error({ err, queueName: worker.name }, `[Worker:${worker.name}] Worker connection/internal error`);
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
