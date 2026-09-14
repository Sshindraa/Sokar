import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import {
  processMarketingProviderReconciliationJob,
  type MarketingProviderReconciliationWorkerDependencies,
} from '../marketing-provider-reconciliation.worker';
import { reconcileMarketingProviderEvents } from '../marketing-provider.service';

vi.mock('../marketing-provider.service', () => ({
  reconcileMarketingProviderEvents: vi.fn(),
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
