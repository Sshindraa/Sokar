import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import {
  processMarketingProviderReconciliationJob,
  type MarketingProviderReconciliationWorkerDependencies,
} from '../marketing-provider-reconciliation.worker';
import { reconcileMarketingProviderEvents } from '../marketing-provider.service';
import { purgeExpiredMarketingOptOuts } from '../marketing-opt-out.service';

vi.mock('../marketing-provider.service', () => ({
  reconcileMarketingProviderEvents: vi.fn(),
}));
vi.mock('../marketing-opt-out.service', () => ({
  purgeExpiredMarketingOptOuts: vi.fn(),
}));

function makeJob(data: { provider?: 'telnyx' | 'resend'; limit?: number } = {}) {
  return {
    id: 'provider-reconciliation-job-1',
    name: 'reconcile-provider-events',
    data,
  } as unknown as Job<{ provider?: 'telnyx' | 'resend'; limit?: number }>;
}

describe('marketing provider reconciliation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reconcileMarketingProviderEvents).mockResolvedValue({
      scanned: 4,
      resolved: 3,
      stillOpen: 1,
    });
    vi.mocked(purgeExpiredMarketingOptOuts).mockResolvedValue(0);
  });

  it('purge le registre d’opposition échu sans jamais faire échouer la réconciliation', async () => {
    const now = new Date('2029-10-24T00:00:00.000Z');
    const deps: MarketingProviderReconciliationWorkerDependencies = {
      db: {} as never,
      reconcile: vi.fn().mockResolvedValue({ scanned: 0, resolved: 0, stillOpen: 0 }),
      now: () => now,
    };
    await processMarketingProviderReconciliationJob(makeJob(), deps);
    expect(purgeExpiredMarketingOptOuts).toHaveBeenCalledWith(now, deps.db);

    vi.mocked(purgeExpiredMarketingOptOuts).mockRejectedValue(new Error('db down'));
    await expect(processMarketingProviderReconciliationJob(makeJob(), deps)).resolves.toEqual({
      scanned: 0,
      resolved: 0,
      stillOpen: 0,
    });
  });

  it('réconcilie les callbacks ouverts avec une limite bornée', async () => {
    const reconcile = vi.fn().mockResolvedValue({ scanned: 4, resolved: 3, stillOpen: 1 });
    const deps: MarketingProviderReconciliationWorkerDependencies = {
      db: {} as never,
      reconcile,
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    };

    await expect(
      processMarketingProviderReconciliationJob(makeJob({ limit: 9999 }), deps),
    ).resolves.toEqual({
      scanned: 4,
      resolved: 3,
      stillOpen: 1,
    });
    expect(reconcile).toHaveBeenCalledWith({
      provider: undefined,
      restaurantId: undefined,
      limit: 500,
      database: deps.db,
      now: new Date('2026-09-14T12:00:00.000Z'),
    });
  });

  it('refuse une date invalide avant toute lecture', async () => {
    const reconcile = vi.fn();
    const deps: MarketingProviderReconciliationWorkerDependencies = {
      db: {} as never,
      reconcile,
      now: () => new Date('invalid'),
    };
    await expect(processMarketingProviderReconciliationJob(makeJob(), deps)).rejects.toThrow(
      'now must be valid',
    );
    expect(reconcile).not.toHaveBeenCalled();
  });
});
