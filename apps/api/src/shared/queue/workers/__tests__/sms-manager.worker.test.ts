import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  send: vi.fn(),
  add: vi.fn(),
  reservation: vi.fn(),
}));
vi.mock('../../../redis/client', () => {
  const store = {
    set: vi.fn(async (key: string, value: string, _mode: string, _seconds: number, nx?: string) => {
      if (nx === 'NX' && mocks.values.has(key)) return null;
      mocks.values.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => mocks.values.get(key) ?? null),
    del: vi.fn(async (key: string) => Number(mocks.values.delete(key))),
    eval: vi.fn(
      async (_script: string, _count: number, key: string, token: string, next: string) => {
        const current = mocks.values.get(key);
        if (!current?.includes(`"token":"${token}"`)) return 0;
        if (next === '__DELETE__') mocks.values.delete(key);
        else mocks.values.set(key, next);
        return 1;
      },
    ),
  };
  return { redisQueue: store, redisSession: store };
});
vi.mock('../../../telnyx/client', () => ({ sendSms: mocks.send }));
vi.mock('../../../db/client', () => ({ db: { reservation: { findFirst: mocks.reservation } } }));
vi.mock('../../queues', () => ({ queues: { reconciliation: { add: mocks.add } } }));
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { processManagerSmsJob } from '../sms-confirmation.worker';

function job(id: string): Job {
  return {
    id,
    data: { restaurantId: 'rest-1', phoneNumber: 'recipient', message: 'alert' },
  } as Job;
}

describe('manager SMS recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.values.clear();
    mocks.add.mockResolvedValue(undefined);
  });

  it('retries the same job after a definite refusal', async () => {
    mocks.send.mockRejectedValueOnce(Object.assign(new Error('refused'), { status: 400 }));
    mocks.send.mockResolvedValueOnce({ outcome: 'success', provider: 'telnyx', channel: 'sms' });
    await expect(processManagerSmsJob(job('one'))).rejects.toThrow('refused');
    await processManagerSmsJob(job('one'));
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('does not resend after a lost response', async () => {
    mocks.send.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    await processManagerSmsJob(job('one'));
    await processManagerSmsJob(job('one'));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.add).toHaveBeenCalled();
  });

  it('keeps the provider id when reconciliation cannot be queued', async () => {
    mocks.send.mockResolvedValue({
      outcome: 'unknown',
      provider: 'telnyx',
      channel: 'sms',
      providerMessageId: 'provider-id',
    });
    mocks.add.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(processManagerSmsJob(job('one'))).rejects.toThrow('queue unavailable');
    expect(JSON.parse(mocks.values.get('notification:manager-alert-sms:one')!)).toMatchObject({
      status: 'unknown',
      providerMessageId: 'provider-id',
    });
    await processManagerSmsJob(job('one'));
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('only lets one simultaneous alert through for a restaurant', async () => {
    mocks.send.mockResolvedValue({ outcome: 'success', provider: 'telnyx', channel: 'sms' });
    await Promise.all([processManagerSmsJob(job('one')), processManagerSmsJob(job('two'))]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('does not discard a cancellation alert because another manager SMS was sent', async () => {
    mocks.values.set('sms:manager:rest-1', 'another-job');
    mocks.reservation.mockResolvedValue({
      reservedAt: new Date('2026-10-29T18:00:00Z'),
      customerName: 'Client',
      partySize: 2,
      restaurant: { managerPhone: 'manager', timezone: 'Europe/Paris' },
    });
    mocks.send.mockResolvedValue({ outcome: 'success', provider: 'telnyx', channel: 'sms' });
    await processManagerSmsJob({ ...job('cancel'), name: 'reply-cancellation' } as Job);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
