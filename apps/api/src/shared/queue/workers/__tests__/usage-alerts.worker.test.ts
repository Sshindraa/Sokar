import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { processUsageAlertsJob, type UsageAlertsWorkerDependencies } from '../usage-alerts.worker';

function job(data: { monthKey?: string; restaurantId?: string } = {}): Job {
  return { id: 'usage-alert-job', name: 'scan', data } as unknown as Job;
}

function dependencies(overrides: Partial<UsageAlertsWorkerDependencies> = {}) {
  const claimStore = { set: vi.fn().mockResolvedValue('OK') };
  const deps: UsageAlertsWorkerDependencies = {
    db: {
      restaurant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'restaurant-1' }]),
      },
    } as unknown as PrismaClient,
    claimStore,
    getUsage: vi.fn().mockResolvedValue([
      { category: 'TELEPHONY_SECONDS', quantity: '5400' },
      { category: 'SMS_SEGMENTS', quantity: '20' },
    ]),
    getBudgets: vi.fn().mockReturnValue({ voiceMinutesMonthly: 60, smsMonthly: 20 }),
    dispatch: vi.fn().mockResolvedValue([]),
    enabled: true,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
    ...overrides,
  };
  return { deps, claimStore };
}

describe('internal usage cost-watch worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ne contacte aucun canal quand le flag est désactivé', async () => {
    const { deps } = dependencies({ enabled: false });
    await expect(processUsageAlertsJob(job(), deps)).resolves.toEqual({
      monthKey: '2026-09',
      restaurants: 0,
      evaluated: 0,
      crossed: 0,
      dispatched: 0,
      skipped: 0,
      disabled: true,
    });
    expect(deps.getUsage).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('réclame chaque seuil une seule fois avant dispatch', async () => {
    const { deps, claimStore } = dependencies();
    await expect(processUsageAlertsJob(job(), deps)).resolves.toMatchObject({
      restaurants: 1,
      evaluated: 1,
      crossed: 6,
      dispatched: 6,
      skipped: 0,
    });
    expect(claimStore.set).toHaveBeenCalledTimes(6);
    expect(deps.dispatch).toHaveBeenCalledTimes(6);
    expect(claimStore.set).toHaveBeenNthCalledWith(
      1,
      'sokar:usage-alert:2026-09:restaurant-1:voiceMinutes:70',
      '1',
      'EX',
      45 * 24 * 60 * 60,
      'NX',
    );
  });

  it('ne dispatch pas une claim déjà prise par un autre worker', async () => {
    const { deps } = dependencies({
      claimStore: { set: vi.fn().mockResolvedValue(null) },
    });
    await expect(processUsageAlertsJob(job(), deps)).resolves.toMatchObject({
      crossed: 6,
      dispatched: 0,
      skipped: 6,
    });
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
});
