import { describe, expect, it, vi, beforeEach } from 'vitest';
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
vi.mock('../../../db/client', () => ({
  db: {},
}));
vi.mock('../../../messaging/sender', () => ({
  sendReminder: vi.fn(),
}));
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { sendReminder, type SendResult } from '../../../messaging/sender';
import {
  processConfirmationSmsJob,
  type ConfirmationSmsDependencies,
  type ConfirmationSmsJobData,
} from '../confirmation-sms.worker';

function makeClaimStore() {
  const claims = new Map<string, string>();
  const set = vi.fn(
    async (
      key: string,
      value: string,
      _expirationMode: 'EX',
      _expirationSeconds: number,
      existenceMode?: 'NX',
    ) => {
      if (existenceMode === 'NX' && claims.has(key)) return null;
      claims.set(key, value);
      return 'OK';
    },
  );
  const get = vi.fn(async (key: string) => claims.get(key) ?? null);
  const del = vi.fn(async (key: string) => {
    claims.delete(key);
    return 1;
  });
  const evalScript = vi.fn(
    async (
      _script: string,
      _numberOfKeys: number,
      key: string,
      token: string,
      nextValue: string,
    ) => {
      const current = claims.get(key);
      if (!current || !current.includes(`\"token\":\"${token}\"`)) return 0;
      if (nextValue === '__DELETE__') claims.delete(key);
      else claims.set(key, nextValue);
      return 1;
    },
  );
  return { claims, store: { set, get, del, eval: evalScript }, set, get, del, evalScript };
}

const reservation = {
  id: 'res-reminder-1',
  restaurantId: 'rest-1',
  customerId: null,
  customerPhone: '+33612345678',
  reservedAt: new Date('2026-07-02T17:00:00.000Z'),
  partySize: 2,
  status: 'CONFIRMED',
  state: 'CONFIRMED',
  confirmationStatus: 'NOT_REQUIRED',
  confirmationSentAt: null as Date | null,
  restaurant: { id: 'rest-1', name: 'Chez Sokar' },
};

function makeJob(): Job<ConfirmationSmsJobData> {
  return {
    id: 'job-reminder-1',
    name: 'send-reminder',
    data: { kind: 'send', reservationId: reservation.id },
  } as unknown as Job<ConfirmationSmsJobData>;
}

function makeDependencies(current = reservation) {
  const { claims, store, set } = makeClaimStore();
  const db = {
    reservation: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue(current),
    },
  };
  const deps: ConfirmationSmsDependencies = {
    db: db as unknown as PrismaClient,
    sendReminder,
    formatDate: vi.fn().mockReturnValue('jeudi 2 juillet 2026'),
    claimStore: store,
  };
  return { db, deps, claims, set };
}

function makeReconciliationQueue() {
  const jobIds = new Set<string>();
  const queue = {
    add: vi.fn(async (_name: string, _data: unknown, options: { jobId: string }) => {
      jobIds.add(options.jobId);
    }),
  };
  return { queue, jobIds };
}

describe('confirmation-sms.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendReminder).mockResolvedValue({ channel: 'sms', success: true });
  });

  it('déduplique deux exécutions pour la même réservation', async () => {
    const { deps } = makeDependencies();

    await Promise.all([
      processConfirmationSmsJob(makeJob(), deps),
      processConfirmationSmsJob(makeJob(), deps),
    ]);

    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(deps.db.reservation.update).toHaveBeenCalledTimes(1);
  });

  it('vérifie l’état avant d’envoyer un rappel', async () => {
    const { deps } = makeDependencies({ ...reservation, status: 'CANCELLED', state: 'CANCELLED' });

    await processConfirmationSmsJob(makeJob(), deps);

    expect(sendReminder).not.toHaveBeenCalled();
    expect(deps.db.reservation.update).not.toHaveBeenCalled();
  });

  it('ne prend pas de claim et n’envoie pas pour PENDING projeté CONFIRMED', async () => {
    const { deps, set } = makeDependencies({ ...reservation, state: 'PENDING' });

    await processConfirmationSmsJob(makeJob(), deps);

    expect(sendReminder).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(deps.db.reservation.update).not.toHaveBeenCalled();
  });

  it('ignore aussi PENDING découvert par le scan sans claim ni provider', async () => {
    const pendingReservation = { ...reservation, state: 'PENDING' };
    const { db, deps, set } = makeDependencies(pendingReservation);
    vi.mocked(db.reservation.findMany).mockResolvedValue([pendingReservation] as never);
    vi.mocked(db.reservation.findUnique).mockResolvedValue(pendingReservation as never);

    await processConfirmationSmsJob(
      {
        id: 'job-reminder-scan-1',
        name: 'scan-reminders',
        data: { kind: 'scan' },
      } as unknown as Job<ConfirmationSmsJobData>,
      deps,
    );

    expect(sendReminder).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(db.reservation.update).not.toHaveBeenCalled();
  });

  it('propage un refus certain à BullMQ et réouvre la notification au retry', async () => {
    const { deps, claims } = makeDependencies();
    const failure: SendResult = { channel: 'sms', success: false, error: 'provider unavailable' };
    vi.mocked(sendReminder)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({ channel: 'sms', success: true });

    await expect(processConfirmationSmsJob(makeJob(), deps)).rejects.toThrow(
      'provider refused the notification',
    );
    expect(claims.size).toBe(0);

    await processConfirmationSmsJob(makeJob(), deps);

    expect(sendReminder).toHaveBeenCalledTimes(2);
    expect(deps.db.reservation.update).toHaveBeenCalledTimes(1);
  });

  it('respecte le marqueur d’envoi déjà présent', async () => {
    const { deps } = makeDependencies({
      ...reservation,
      confirmationSentAt: new Date('2026-07-01T17:00:00.000Z'),
    });

    await processConfirmationSmsJob(makeJob(), deps);

    expect(sendReminder).not.toHaveBeenCalled();
  });

  it('conserve la claim et bloque le retry après un résultat unknown', async () => {
    const { deps, claims } = makeDependencies();
    const { queue, jobIds } = makeReconciliationQueue();
    deps.reconciliationQueue = queue;
    vi.mocked(sendReminder).mockResolvedValue({
      channel: 'sms',
      success: false,
      outcome: 'unknown',
      provider: 'telnyx',
    });

    await processConfirmationSmsJob(makeJob(), deps);
    await processConfirmationSmsJob(makeJob(), deps);

    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(deps.db.reservation.update).not.toHaveBeenCalled();
    expect(claims.size).toBe(1);
    expect(jobIds.size).toBe(1);
  });

  it('délègue les claims de canal au sender dans le mode de production', async () => {
    const { deps, claims } = makeDependencies();
    deps.manageReminderClaims = true;

    await processConfirmationSmsJob(makeJob(), deps);

    expect(sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: reservation.id }),
      expect.objectContaining({ claimStore: deps.claimStore }),
    );
    expect(claims.size).toBe(0);
  });
});
