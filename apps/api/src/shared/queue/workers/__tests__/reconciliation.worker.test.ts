import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../../redis/client', () => ({
  redisQueue: {
    url: 'redis://localhost:6379',
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../../email', () => ({ lookupResendEmail: vi.fn() }));
vi.mock('../../../telnyx/client', () => ({ lookupTelnyxMessage: vi.fn() }));
vi.mock('../../queues', () => ({
  queues: {
    deadLetter: { add: vi.fn().mockResolvedValue(undefined) },
    reconciliation: { add: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  acquireNotificationClaim,
  buildNotificationClaimKey,
  getNotificationClaim,
  NOTIFICATION_CLAIM_LEASE_SECONDS,
  recordNotificationResult,
  type NotificationClaimStore,
  type NotificationReconciliationJobData,
} from '../../notification-idempotency';
import {
  processReconciliationJob,
  type ReconciliationJobData,
  type ReconciliationDependencies,
} from '../reconciliation.worker';

function makeClaimStore() {
  const values = new Map<string, string>();
  const scan = vi.fn(async (cursor: string) => {
    return ['0', cursor === '0' ? [...values.keys()] : []] as [string, string[]];
  });
  const store: NotificationClaimStore = {
    async set(key, value, _expirationMode, _expirationSeconds, existenceMode) {
      if (existenceMode === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async del(key) {
      values.delete(key);
      return 1;
    },
    async eval(script, _numberOfKeys, key, token, ...args) {
      const raw = values.get(key);
      if (!raw) return 0;
      const current = JSON.parse(raw) as { token?: string; status?: string };
      if (current.token !== token) return 0;
      const guardedByStatus = script.includes('local status =');
      const expectedStatus = guardedByStatus ? args[0] : undefined;
      const nextValue = guardedByStatus ? args[1] : args[0];
      if (guardedByStatus && current.status !== expectedStatus) return 0;
      if (nextValue === '__DELETE__') values.delete(key);
      else values.set(key, nextValue);
      return 1;
    },
    scan: scan as unknown as NonNullable<NotificationClaimStore['scan']>,
  };
  return { store, values, scan };
}

function makeQueue() {
  const acceptedJobIds = new Set<string>();
  const jobs: Array<{ name: string; data: unknown; jobId: string }> = [];
  const queue = {
    add: vi.fn(async (name: string, data: unknown, options: { jobId: string }) => {
      if (!acceptedJobIds.has(options.jobId)) {
        acceptedJobIds.add(options.jobId);
        jobs.push({ name, data, jobId: options.jobId });
      }
    }),
  };
  return { queue, jobs };
}

function makeJob(
  overrides: Partial<Omit<NotificationReconciliationJobData, 'kind' | 'claimKey'>> & {
    claimKey?: string;
  } = {},
): Job<NotificationReconciliationJobData> {
  return {
    id: 'notification-reconciliation-job',
    name: 'notification-status',
    data: {
      kind: 'notification',
      claimKey: overrides.claimKey ?? buildNotificationClaimKey('reminder', 'res-1'),
      provider: overrides.provider ?? 'telnyx',
      channel: overrides.channel ?? 'sms',
      ...(overrides.providerMessageId ? { providerMessageId: overrides.providerMessageId } : {}),
    },
  } as unknown as Job<NotificationReconciliationJobData>;
}

async function makeUnknownClaim(
  store: NotificationClaimStore,
  key: string,
  providerMessageId?: string,
) {
  const attempt = await acquireNotificationClaim(store, key, {
    provider: 'telnyx',
    channel: 'sms',
  });
  await recordNotificationResult(store, key, attempt.token!, 'unknown', {
    provider: 'telnyx',
    channel: 'sms',
    ...(providerMessageId ? { providerMessageId } : {}),
  });
}

function makeDependencies(
  store: NotificationClaimStore,
  lookupProviderMessage: ReconciliationDependencies['lookupProviderMessage'],
  deadLetterQueue: ReconciliationDependencies['deadLetterQueue'],
  options: {
    reconciliationQueue?: ReconciliationDependencies['reconciliationQueue'];
    repairNotification?: ReconciliationDependencies['repairNotification'];
  } = {},
): ReconciliationDependencies {
  return {
    db: {} as PrismaClient,
    claimStore: store,
    lookupProviderMessage,
    deadLetterQueue,
    ...(options.reconciliationQueue ? { reconciliationQueue: options.reconciliationQueue } : {}),
    repairNotification: options.repairNotification ?? vi.fn().mockResolvedValue('not_required'),
  };
}

describe('reconciliation.worker notification outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marque un succès provider réconcilié sans envoyer ni ouvrir la DLQ', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-success');
    await makeUnknownClaim(store, key, 'msg-success');
    const lookupProviderMessage = vi.fn().mockResolvedValue('success');
    const { queue: deadLetterQueue, jobs } = makeQueue();

    await processReconciliationJob(
      makeJob({ claimKey: key, providerMessageId: 'msg-success' }),
      makeDependencies(store, lookupProviderMessage, deadLetterQueue),
    );

    expect(lookupProviderMessage).toHaveBeenCalledWith({
      provider: 'telnyx',
      channel: 'sms',
      providerMessageId: 'msg-success',
    });
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'success' });
    expect(jobs).toHaveLength(0);
  });

  it('libère la claim uniquement après une preuve d’échec certain', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-failed');
    await makeUnknownClaim(store, key, 'msg-failed');
    const lookupProviderMessage = vi.fn().mockResolvedValue('failure_certain');
    const { queue: deadLetterQueue, jobs } = makeQueue();

    await processReconciliationJob(
      makeJob({ claimKey: key, providerMessageId: 'msg-failed' }),
      makeDependencies(store, lookupProviderMessage, deadLetterQueue),
    );

    expect(await getNotificationClaim(store, key)).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  it('conserve unknown et crée une seule revue manuelle déterministe', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-unknown');
    await makeUnknownClaim(store, key, 'msg-unknown');
    const lookupProviderMessage = vi.fn().mockResolvedValue('unknown');
    const { queue: deadLetterQueue, jobs } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue);

    await processReconciliationJob(
      makeJob({ claimKey: key, providerMessageId: 'msg-unknown' }),
      deps,
    );
    await processReconciliationJob(
      makeJob({ claimKey: key, providerMessageId: 'msg-unknown' }),
      deps,
    );

    expect(lookupProviderMessage).toHaveBeenCalledTimes(2);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'unknown' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: 'notification-reconciliation-manual' });
  });

  it('envoie sans consultation les claims sans identifiant vers la revue manuelle', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-no-id');
    await makeUnknownClaim(store, key);
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue, jobs } = makeQueue();

    await processReconciliationJob(
      makeJob({ claimKey: key }),
      makeDependencies(store, lookupProviderMessage, deadLetterQueue),
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'unknown' });
  });

  it('ne consulte ni ne renvoie un provider pour une claim encore en cours', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-in-progress');
    await acquireNotificationClaim(store, key, { provider: 'telnyx', channel: 'sms' });
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue, jobs } = makeQueue();

    await processReconciliationJob(
      makeJob({ claimKey: key, providerMessageId: 'msg-in-progress' }),
      makeDependencies(store, lookupProviderMessage, deadLetterQueue),
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'in_progress' });
  });

  it('accorde un seul lease lors de deux réconciliations concurrentes', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-concurrent');
    await makeUnknownClaim(store, key, 'msg-concurrent');
    const lookupProviderMessage = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'success' as const;
    });
    const { queue: deadLetterQueue } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue);

    await Promise.all([
      processReconciliationJob(
        makeJob({ claimKey: key, providerMessageId: 'msg-concurrent' }),
        deps,
      ),
      processReconciliationJob(
        makeJob({ claimKey: key, providerMessageId: 'msg-concurrent' }),
        deps,
      ),
    ]);

    expect(lookupProviderMessage).toHaveBeenCalledTimes(1);
    expect(deps.repairNotification).toHaveBeenCalledTimes(1);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'success' });
  });

  it('récupère une claim in_progress orpheline sans rappeler le provider', async () => {
    const { store, values } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-orphan');
    const attempt = await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });
    const record = JSON.parse(values.get(key)!) as Record<string, unknown>;
    record.updatedAt = new Date(
      Date.now() - NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 - 1,
    ).toISOString();
    values.set(key, JSON.stringify(record));
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue } = makeQueue();
    const { queue: reconciliationQueue, jobs } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      reconciliationQueue,
    });

    await processReconciliationJob(
      {
        id: 'daily-sms-reconciliation',
        name: 'sms',
        data: { kind: 'sms', dayKey: '2026-09-01' },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(attempt.token).toBeTruthy();
    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'unknown' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: 'notification-status' });
  });

  it('simule un arrêt brutal après le provider puis reprend sans second envoi', async () => {
    const { store, values } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-crash');
    const sendProvider = vi.fn().mockResolvedValue({ id: 'msg-crash' });
    const attempt = await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });

    await sendProvider();
    // Crash simulé : l'appel provider a répondu, mais recordNotificationResult
    // n'a pas encore pu exécuter la transition Redis.
    const record = JSON.parse(values.get(key)!) as Record<string, unknown>;
    record.providerMessageId = 'msg-crash';
    record.updatedAt = new Date(
      Date.now() - NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 - 1,
    ).toISOString();
    values.set(key, JSON.stringify(record));

    const lookupProviderMessage = vi.fn().mockResolvedValue('success');
    const { queue: deadLetterQueue } = makeQueue();
    const { queue: reconciliationQueue, jobs } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      reconciliationQueue,
    });

    await processReconciliationJob(
      {
        id: 'daily-sms-reconciliation-crash',
        name: 'sms',
        data: { kind: 'sms', dayKey: '2026-09-01' },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );
    await processReconciliationJob(
      {
        id: 'recovered-notification',
        name: 'notification-status',
        data: jobs[0].data,
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(attempt.token).toBeTruthy();
    expect(sendProvider).toHaveBeenCalledTimes(1);
    expect(lookupProviderMessage).toHaveBeenCalledTimes(1);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'success' });
  });

  it('ne touche pas une claim active pendant le balayage', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-active-sweep');
    await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue } = makeQueue();
    const { queue: reconciliationQueue, jobs } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      reconciliationQueue,
    });

    await processReconciliationJob(
      {
        id: 'daily-sms-reconciliation-active',
        name: 'sms',
        data: { kind: 'sms', dayKey: '2026-09-01' },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'in_progress' });
  });

  it('conserve unknown si la queue de réconciliation est indisponible', async () => {
    const { store, values } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-queue-down');
    await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });
    const record = JSON.parse(values.get(key)!) as Record<string, unknown>;
    record.updatedAt = new Date(
      Date.now() - NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 - 1,
    ).toISOString();
    values.set(key, JSON.stringify(record));
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue);

    await processReconciliationJob(
      {
        id: 'daily-sms-reconciliation-queue-down',
        name: 'sms',
        data: { kind: 'sms', dayKey: '2026-09-01' },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'unknown' });
  });

  it('n’envoie rien si le balayage Redis devient indisponible', async () => {
    const { store, scan } = makeClaimStore();
    scan.mockRejectedValueOnce(new Error('Redis unavailable'));
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue, jobs } = makeQueue();
    const { queue: reconciliationQueue } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      reconciliationQueue,
    });

    await processReconciliationJob(
      {
        id: 'daily-sms-reconciliation-redis-down',
        name: 'sms',
        data: { kind: 'sms', dayKey: '2026-09-01' },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(reconciliationQueue.add).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it('envoie une claim legacy sans token vers la revue manuelle', async () => {
    const { store, values } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-legacy');
    values.set(key, 'claimed');
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue, jobs } = makeQueue();
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      reconciliationQueue: makeQueue().queue,
    });

    await processReconciliationJob(
      {
        id: 'daily-sms-reconciliation-legacy',
        name: 'sms',
        data: { kind: 'sms', dayKey: '2026-09-01' },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: 'notification-reconciliation-manual' });
  });

  it('ne renvoie pas après un échec de création du job de réconciliation', async () => {
    const { store, values } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-requeue-failed');
    await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });
    const record = JSON.parse(values.get(key)!) as Record<string, unknown>;
    record.updatedAt = new Date(
      Date.now() - NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 - 1,
    ).toISOString();
    record.providerMessageId = 'msg-requeue-failed';
    values.set(key, JSON.stringify(record));
    const lookupProviderMessage = vi.fn();
    const { queue: deadLetterQueue } = makeQueue();
    const reconciliationQueue = {
      add: vi.fn().mockRejectedValue(new Error('Redis queue unavailable')),
    };
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      reconciliationQueue,
    });

    await processReconciliationJob(
      {
        id: 'requeue-failed',
        name: 'sms',
        data: {
          kind: 'sms',
          dayKey: '2026-09-01',
        },
      } as unknown as Job<ReconciliationJobData>,
      deps,
    );

    expect(lookupProviderMessage).not.toHaveBeenCalled();
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'unknown' });
    expect(reconciliationQueue.add).toHaveBeenCalledTimes(1);
  });

  it('laisse unknown et ouvre une revue si la réparation locale est impossible', async () => {
    const { store } = makeClaimStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-repair-failed');
    await makeUnknownClaim(store, key, 'msg-repair-failed');
    const lookupProviderMessage = vi.fn().mockResolvedValue('success');
    const { queue: deadLetterQueue, jobs } = makeQueue();
    const repairNotification = vi.fn().mockResolvedValue('manual');
    const deps = makeDependencies(store, lookupProviderMessage, deadLetterQueue, {
      repairNotification,
    });

    await processReconciliationJob(
      makeJob({ claimKey: key, providerMessageId: 'msg-repair-failed' }),
      deps,
    );

    expect(repairNotification).toHaveBeenCalledWith(key, expect.any(Date));
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'unknown' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ reason: 'local_repair_failed' });
  });
});
