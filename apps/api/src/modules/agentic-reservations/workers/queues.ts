/**
 * File d'attente pour les workers agentic (expire-hold, expire-quote,
 * agentic-notify). Ces queues rejoignent celles déjà définies dans
 * shared/queue/queues.ts.
 */

import { Queue } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { defaultReliableJobOptions, sanitizeJobId } from '../../../shared/queue/job-options';
import { AGENTIC_QUEUE_REMOVE_ON_COMPLETE } from '../../../shared/queue/constants.js';
import { queues } from '../../../shared/queue/queues';

export const agenticExpireHoldQueue = new Queue('agentic-expire-hold', {
  connection: redisQueue,
  defaultJobOptions: defaultReliableJobOptions,
});

export const agenticExpireQuoteQueue = new Queue('agentic-expire-quote', {
  connection: redisQueue,
  defaultJobOptions: defaultReliableJobOptions,
});

export const agenticNotifyQueue = new Queue('agentic-notify', {
  connection: redisQueue,
  defaultJobOptions: defaultReliableJobOptions,
});

export const agenticWaitingListExpireQueue = new Queue('agentic-waiting-list-expire', {
  connection: redisQueue,
  defaultJobOptions: defaultReliableJobOptions,
});

/**
 * Planifie un job d'expiration pour un hold créé à now.
 * Le délai est en ms. On utilise un jobId déterministe pour éviter
 * les doublons en cas de re-schedule.
 */
export async function scheduleHoldExpiration(args: {
  holdId: string;
  expiresAt: Date;
}): Promise<void> {
  const delay = Math.max(0, args.expiresAt.getTime() - Date.now());
  await agenticExpireHoldQueue.add(
    'expire',
    { holdId: args.holdId },
    {
      delay,
      jobId: sanitizeJobId(`hold_${args.holdId}`),
      removeOnComplete: AGENTIC_QUEUE_REMOVE_ON_COMPLETE,
      removeOnFail: AGENTIC_QUEUE_REMOVE_ON_COMPLETE,
    },
  );
}

export async function scheduleQuoteExpiration(args: {
  quoteId: string;
  expiresAt: Date;
}): Promise<void> {
  const delay = Math.max(0, args.expiresAt.getTime() - Date.now());
  await agenticExpireQuoteQueue.add(
    'expire',
    { quoteId: args.quoteId },
    {
      delay,
      jobId: sanitizeJobId(`quote_${args.quoteId}`),
      removeOnComplete: AGENTIC_QUEUE_REMOVE_ON_COMPLETE,
      removeOnFail: AGENTIC_QUEUE_REMOVE_ON_COMPLETE,
    },
  );
}

export async function scheduleAgenticNotification(args: {
  reservationId: string;
  channel: 'sms' | 'email';
  reason: 'created' | 'updated' | 'cancelled';
  delayMs?: number;
}): Promise<void> {
  await agenticNotifyQueue.add('notify', args, {
    delay: args.delayMs ?? 0,
    jobId: sanitizeJobId(`notify_${args.reservationId}_${args.reason}_${args.channel}`),
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}

export async function scheduleWaitingListExpiration(args: {
  entryId: string;
  expiresAt: Date;
}): Promise<void> {
  const delay = Math.max(0, args.expiresAt.getTime() - Date.now());
  await agenticWaitingListExpireQueue.add(
    'expire',
    { entryId: args.entryId },
    {
      delay,
      jobId: sanitizeJobId(`waiting-list_${args.entryId}`),
      removeOnComplete: AGENTIC_QUEUE_REMOVE_ON_COMPLETE,
      removeOnFail: AGENTIC_QUEUE_REMOVE_ON_COMPLETE,
    },
  );
}

export async function scheduleWaitingListPromotionNotification(args: {
  entryId: string;
  reservationId: string;
}): Promise<void> {
  const channels: Array<'sms' | 'email'> = ['sms', 'email'];
  for (const channel of channels) {
    const jobId = sanitizeJobId(`waiting-list-promote_${args.entryId}_${channel}`);
    await queues.waitingListPromote.add(
      'notify',
      { entryId: args.entryId, reservationId: args.reservationId, channel },
      { jobId },
    );
  }
}
