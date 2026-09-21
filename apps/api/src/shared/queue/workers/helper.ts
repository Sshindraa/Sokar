import { Worker, type Job } from 'bullmq';
import { logger } from '../../logger/pino';
import { captureException } from '../../sentry/client';
import { queues } from '../queues';
import { sanitizeJobId } from '../job-options';
import { buildDeadLetterPayload, redactJobData } from '../dead-letter.service';
import { registerWorker } from './registry';

interface JobLogData {
  readonly restaurantId?: string;
  readonly idempotencyKey?: string;
}

/**
 * Returns a Pino child logger pre-bound with the job's context:
 *   { queue, job_id, job_name, restaurant_id?, idempotency_key? }
 */
export function jobLogger(job: Job): ReturnType<typeof logger.child> {
  const data = (job.data ?? {}) as JobLogData;
  return logger.child({
    queue: job.queueName,
    job_id: job.id,
    job_name: job.name,
    attempts_made: job.attemptsMade,
    ...(data.restaurantId ? { restaurant_id: data.restaurantId } : {}),
    ...(data.idempotencyKey ? { idempotency_key: data.idempotencyKey } : {}),
  });
}

async function moveFailedJobToDeadLetter(worker: Worker, job: Job, err: Error): Promise<void> {
  const maxAttempts = job.opts.attempts ?? 1;
  const willRetry = job.attemptsMade < maxAttempts;
  if (willRetry) return;

  const payload = buildDeadLetterPayload({
    queueName: worker.name,
    jobName: job.name,
    jobId: job.id,
    attemptsMade: job.attemptsMade,
    data: job.data,
    error: { message: err.message, stack: err.stack },
  });

  await queues.deadLetter.add(`${worker.name}:${job.name}`, payload, {
    jobId: sanitizeJobId(`dead_${worker.name}_${job.id ?? job.name}_${job.attemptsMade}`),
    removeOnComplete: 5000,
    removeOnFail: false,
  });
}

export function setupWorkerListeners(worker: Worker) {
  registerWorker(worker);

  worker.on('completed', (job) => {
    jobLogger(job).info('job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        err,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        attempts: job?.opts.attempts,
        queueName: worker.name,
        jobData: redactJobData(job?.data),
      },
      `[Worker:${worker.name}] Job ${job?.id ?? 'unknown'} failed`,
    );

    captureException(err, {
      tags: {
        queue: worker.name,
        jobId: job?.id,
        jobName: job?.name,
      },
      extra: {
        attemptsMade: job?.attemptsMade,
        attempts: job?.opts.attempts,
        jobData: redactJobData(job?.data),
      },
    });

    if (job) {
      moveFailedJobToDeadLetter(worker, job, err).catch((deadLetterErr) => {
        logger.error(
          { err: deadLetterErr, jobId: job.id, queueName: worker.name },
          `[Worker:${worker.name}] Failed to move job to dead-letter queue`,
        );
      });
    }
  });

  worker.on('error', (err) => {
    logger.error(
      { err, queueName: worker.name },
      `[Worker:${worker.name}] Worker connection/internal error`,
    );
    captureException(err, {
      tags: {
        queue: worker.name,
        errorType: 'worker-internal',
      },
    });
  });
}
