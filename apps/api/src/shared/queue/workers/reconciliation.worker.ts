import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { queues } from '../queues';
import { lookupResendEmail } from '../../email';
import { lookupTelnyxMessage } from '../../telnyx/client';
import {
  recordNotificationClaimEvent,
  recordNotificationProviderResult,
} from '../../observability/metrics';
import { setupWorkerListeners, jobLogger } from './helper';
import {
  acquireNotificationReconciliationLease,
  buildNotificationReconciliationJobId,
  getNotificationClaim,
  recoverNotificationClaim,
  scanNotificationClaimKeys,
  type NotificationClaimStore,
  type NotificationProvider,
  type NotificationProviderResult,
  type NotificationReconciliationQueue,
  type NotificationReconciliationJobData,
} from '../notification-idempotency';
import { recordNotificationResult } from '../notification-idempotency';
import {
  repairNotificationAfterProviderSuccess,
  type NotificationRepairStatus,
} from '../notification-repair';

interface DailyReconciliationJobData {
  readonly kind: 'calls' | 'sms';
  readonly dayKey?: string;
}

export type ReconciliationJobData = DailyReconciliationJobData | NotificationReconciliationJobData;

export type NotificationProviderLookup = (input: {
  provider: NotificationProvider;
  channel: NotificationReconciliationJobData['channel'];
  providerMessageId: string;
}) => Promise<NotificationProviderResult>;

interface ManualReviewQueue {
  add(name: string, data: unknown, options: { jobId: string }): Promise<unknown>;
}

export interface ReconciliationDependencies {
  db: PrismaClient;
  claimStore: NotificationClaimStore;
  lookupProviderMessage: NotificationProviderLookup;
  deadLetterQueue: ManualReviewQueue;
  reconciliationQueue?: NotificationReconciliationQueue;
  repairNotification?: (claimKey: string, now?: Date) => Promise<NotificationRepairStatus>;
}

function getDefaultDependencies(): ReconciliationDependencies {
  return {
    db,
    claimStore: redisQueue,
    lookupProviderMessage: async ({ provider, providerMessageId }) => {
      if (provider === 'resend') return lookupResendEmail(providerMessageId);
      return lookupTelnyxMessage(providerMessageId);
    },
    deadLetterQueue: queues.deadLetter,
    reconciliationQueue: queues.reconciliation,
    repairNotification: (claimKey, now) =>
      repairNotificationAfterProviderSuccess(db, claimKey, now),
  };
}

function yesterdayKey(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getDayRange(dayKey = yesterdayKey()): { start: Date; end: Date; dayKey: string } {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  const end = new Date(`${dayKey}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid reconciliation dayKey: ${dayKey}`);
  }
  return { start, end, dayKey };
}

function buildManualReviewJobId(claimKey: string): string {
  return `${buildNotificationReconciliationJobId(claimKey)}_manual`;
}

async function enqueueManualReview(
  deps: ReconciliationDependencies,
  data: NotificationReconciliationJobData,
  reason:
    | 'provider_status_unavailable'
    | 'provider_message_id_missing'
    | 'local_repair_failed'
    | 'claim_metadata_missing',
): Promise<void> {
  await deps.deadLetterQueue.add(
    'notification-reconciliation-manual',
    {
      kind: 'notification-reconciliation-manual',
      claimKey: data.claimKey,
      provider: data.provider,
      channel: data.channel,
      ...(data.providerMessageId ? { providerMessageId: data.providerMessageId } : {}),
      reason,
      createdAt: new Date().toISOString(),
    },
    { jobId: buildManualReviewJobId(data.claimKey) },
  );
}

async function enqueueClaimReconciliation(
  deps: ReconciliationDependencies,
  data: NotificationReconciliationJobData,
): Promise<void> {
  if (!deps.reconciliationQueue) {
    throw new Error('notification reconciliation queue unavailable');
  }
  await deps.reconciliationQueue.add('notification-status', data, {
    jobId: buildNotificationReconciliationJobId(data.claimKey),
  });
}

async function sweepNotificationClaims(
  deps: ReconciliationDependencies,
  log: ReturnType<typeof jobLogger>,
): Promise<void> {
  if (!deps.claimStore.scan) {
    recordNotificationClaimEvent('scan_unavailable');
    log.warn('notification claim sweep skipped: Redis scan unavailable');
    return;
  }

  let keys: string[];
  try {
    keys = await scanNotificationClaimKeys(deps.claimStore);
  } catch (err) {
    recordNotificationClaimEvent('scan_failed');
    log.error({ err }, 'notification claim sweep failed');
    return;
  }

  for (const claimKey of keys) {
    let recovery;
    try {
      recovery = await recoverNotificationClaim(deps.claimStore, claimKey);
    } catch (err) {
      log.error({ err }, 'notification claim recovery failed');
      continue;
    }

    const record = recovery.record ?? (await getNotificationClaim(deps.claimStore, claimKey));
    if (!record || record.status === 'success') continue;
    if (recovery.status === 'active') {
      recordNotificationClaimEvent('active');
      continue;
    }
    if (recovery.status === 'recovered') recordNotificationClaimEvent('orphan_recovered');
    if (recovery.status === 'raced') recordNotificationClaimEvent('raced');
    if (recovery.status === 'manual') recordNotificationClaimEvent('manual_review');

    const provider = record.provider;
    const channel = record.channel;
    const data =
      provider && channel
        ? {
            kind: 'notification' as const,
            claimKey,
            provider,
            channel,
            ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
          }
        : null;

    if (!data) {
      try {
        await enqueueManualReview(
          deps,
          {
            kind: 'notification',
            claimKey,
            provider: 'telnyx',
            channel: 'sms',
          },
          'claim_metadata_missing',
        );
      } catch (err) {
        recordNotificationClaimEvent('queue_unavailable');
        log.error({ err }, 'notification claim manual review enqueue failed');
      }
      continue;
    }

    try {
      await enqueueClaimReconciliation(deps, data);
      recordNotificationClaimEvent('unknown_requeued');
    } catch (err) {
      recordNotificationClaimEvent('queue_unavailable');
      log.error({ err }, 'notification claim reconciliation enqueue failed');
    }
  }

  log.info({ scanned: keys.length }, 'notification claim sweep complete');
}

async function processNotificationReconciliation(
  job: Job<NotificationReconciliationJobData>,
  deps: ReconciliationDependencies,
): Promise<void> {
  const log = jobLogger(job);
  const data = job.data;
  const claim = await getNotificationClaim(deps.claimStore, data.claimKey);

  if (!claim) {
    log.warn({ outcome: 'unknown' }, 'notification reconciliation claim not found');
    return;
  }
  if (claim.status === 'success') {
    log.info({ outcome: 'reconciled_success' }, 'notification reconciliation already successful');
    return;
  }
  if (claim.status !== 'unknown') {
    // A job can race with the worker before it records the provider result.
    // It must not query or send while the original attempt is in progress.
    log.info({ outcome: 'unknown' }, 'notification reconciliation deferred: claim in progress');
    return;
  }

  const lease = await acquireNotificationReconciliationLease(deps.claimStore, data.claimKey);
  if (!lease.acquired || !lease.token) {
    log.info({ outcome: 'unknown' }, 'notification reconciliation deferred: concurrent lease');
    return;
  }

  const leasedClaim = lease.record ?? claim;
  const provider = leasedClaim.provider ?? data.provider;
  const channel = leasedClaim.channel ?? data.channel;
  const providerMessageId = leasedClaim.providerMessageId ?? data.providerMessageId;
  const lookupData: NotificationReconciliationJobData = {
    kind: 'notification',
    claimKey: data.claimKey,
    provider,
    channel,
    ...(providerMessageId ? { providerMessageId } : {}),
  };

  if (!providerMessageId) {
    await recordNotificationResult(deps.claimStore, data.claimKey, lease.token, 'unknown', {
      provider,
      channel,
    });
    recordNotificationProviderResult(provider, channel, 'reconciled_unknown');
    try {
      await enqueueManualReview(deps, lookupData, 'provider_message_id_missing');
    } catch (err) {
      log.error({ err }, 'notification reconciliation manual review enqueue failed');
    }
    log.warn(
      { provider, channel, outcome: 'reconciled_unknown' },
      'notification reconciliation needs manual review: provider message id unavailable',
    );
    return;
  }

  let outcome: NotificationProviderResult;
  try {
    outcome = await deps.lookupProviderMessage({ provider, channel, providerMessageId });
  } catch {
    outcome = 'unknown';
  }

  if (outcome === 'success' || outcome === 'failure_certain') {
    if (outcome === 'success') {
      let repairStatus: NotificationRepairStatus = 'manual';
      try {
        const repair =
          deps.repairNotification ??
          ((claimKey: string, now?: Date) =>
            repairNotificationAfterProviderSuccess(deps.db, claimKey, now));
        repairStatus = await repair(data.claimKey, new Date());
      } catch (err) {
        log.error({ err }, 'notification local repair failed');
      }

      if (repairStatus === 'manual') {
        await recordNotificationResult(deps.claimStore, data.claimKey, lease.token, 'unknown', {
          provider,
          channel,
          providerMessageId,
        });
        recordNotificationProviderResult(provider, channel, 'reconciled_unknown');
        try {
          await enqueueManualReview(deps, lookupData, 'local_repair_failed');
        } catch (err) {
          log.error({ err }, 'notification local repair review enqueue failed');
        }
        log.warn(
          { provider, channel, outcome: 'reconciled_unknown', repairStatus },
          'notification provider accepted but local repair needs manual review',
        );
        return;
      }
    }

    const transitioned = await recordNotificationResult(
      deps.claimStore,
      data.claimKey,
      lease.token,
      outcome,
      {
        provider,
        channel,
        providerMessageId,
      },
    );
    recordNotificationProviderResult(
      provider,
      channel,
      outcome === 'success' ? 'reconciled_success' : 'reconciled_failure',
    );
    log.info(
      {
        provider,
        channel,
        outcome: outcome === 'success' ? 'reconciled_success' : 'reconciled_failure',
        transitioned,
      },
      'notification reconciliation completed',
    );
    return;
  }

  // Unknown remains unknown. The manual queue is deterministic and the claim
  // is intentionally not released, so a later retry cannot send blindly.
  await recordNotificationResult(deps.claimStore, data.claimKey, lease.token, 'unknown', {
    provider,
    channel,
    providerMessageId,
  });
  recordNotificationProviderResult(provider, channel, 'reconciled_unknown');
  try {
    await enqueueManualReview(deps, lookupData, 'provider_status_unavailable');
  } catch (err) {
    log.error({ err }, 'notification reconciliation manual review enqueue failed');
  }
  log.warn(
    { provider, channel, outcome: 'reconciled_unknown' },
    'notification reconciliation remains unknown',
  );
}

export async function processReconciliationJob(
  job: Job<ReconciliationJobData>,
  deps: ReconciliationDependencies = getDefaultDependencies(),
): Promise<void> {
  const log = jobLogger(job);
  const data = job.data;

  if (data.kind === 'notification') {
    await processNotificationReconciliation(job as Job<NotificationReconciliationJobData>, deps);
    return;
  }

  const { start, end, dayKey } = getDayRange(data.dayKey);

  if (data.kind === 'calls') {
    const calls = await deps.db.call.findMany({
      where: {
        carrier: 'telnyx',
        createdAt: { gte: start, lte: end },
        OR: [{ durationSec: null }, { outcome: null }],
      },
      select: {
        id: true,
        restaurantId: true,
        callSid: true,
        durationSec: true,
        outcome: true,
        createdAt: true,
      },
      take: 500,
    });

    log.warn(
      {
        dayKey,
        unresolvedCount: calls.length,
        unresolvedCallSids: calls.map((call) => call.callSid).slice(0, 25),
      },
      'call reconciliation completed',
    );
    return;
  }

  await sweepNotificationClaims(deps, log);
  log.info({ dayKey }, 'sms reconciliation completed');
}

export const reconciliationWorker = new Worker(
  'reconciliation',
  (job) => processReconciliationJob(job as Job<ReconciliationJobData>),
  { connection: redisQueue, concurrency: 2 },
);

setupWorkerListeners(reconciliationWorker);
