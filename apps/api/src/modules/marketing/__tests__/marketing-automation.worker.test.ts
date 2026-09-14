import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import {
  processMarketingAutomationJob,
  type MarketingAutomationWorkerDependencies,
} from '../marketing-automation.worker';
import { evaluateMarketingAutomations } from '../marketing-automation.service';

vi.mock('../marketing-automation.service', () => ({
  evaluateMarketingAutomations: vi.fn(),
}));

function makeJob(): Job<{ kind: 'scan'; restaurantId?: string }> {
  return {
    id: 'automation-job-1',
    name: 'automation-scan',
    data: { kind: 'scan' },
  } as unknown as Job<{ kind: 'scan'; restaurantId?: string }>;
}

describe('marketing automation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(evaluateMarketingAutomations).mockResolvedValue({
      automations: 3,
      campaigns: 1,
      eligible: 2,
    });
  });

  it('évalue mais n envoie rien tant que le gel fournisseur est actif', async () => {
    const campaignFindMany = vi.fn();
    const deps: MarketingAutomationWorkerDependencies = {
      db: { marketingAutomation: {}, marketingCampaign: { findMany: campaignFindMany } } as never,
      enqueueCampaign: vi.fn(),
      sendsEnabled: false,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    };

    await expect(processMarketingAutomationJob(makeJob(), deps)).resolves.toEqual({
      automations: 3,
      campaigns: 1,
      eligible: 2,
      queued: 0,
    });
    expect(campaignFindMany).not.toHaveBeenCalled();
  });

  it('réenfile les campagnes READY grâce à leur dispatch durable', async () => {
    const campaignFindMany = vi.fn().mockResolvedValue([
      { id: 'campaign-1', restaurantId: 'restaurant-1' },
      { id: 'campaign-2', restaurantId: 'restaurant-1' },
    ]);
    const enqueueCampaign = vi.fn().mockResolvedValue({});
    const deps: MarketingAutomationWorkerDependencies = {
      db: { marketingAutomation: {}, marketingCampaign: { findMany: campaignFindMany } } as never,
      enqueueCampaign,
      sendsEnabled: true,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    };

    await expect(processMarketingAutomationJob(makeJob(), deps)).resolves.toMatchObject({
      queued: 2,
    });
    expect(campaignFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          automationDispatches: { some: {} },
        }),
      }),
    );
    expect(enqueueCampaign).toHaveBeenNthCalledWith(
      1,
      'send-campaign',
      { campaignId: 'campaign-1', restaurantId: 'restaurant-1' },
      { jobId: 'marketing-campaign:campaign-1' },
    );
  });
});
