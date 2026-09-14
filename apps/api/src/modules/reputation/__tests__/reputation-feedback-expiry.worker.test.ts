import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { expireReputationFeedbackRequests } from '../reputation.service';
import {
  processReputationFeedbackExpiryJob,
  type ReputationFeedbackExpiryJobData,
} from '../reputation-feedback-expiry.worker';

vi.mock('../reputation.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reputation.service')>();
  return {
    ...actual,
    expireReputationFeedbackRequests: vi.fn(),
  };
});

function job(data: ReputationFeedbackExpiryJobData = {}): Job<ReputationFeedbackExpiryJobData> {
  return {
    id: 'reputation-expiry-1',
    name: 'scan',
    data,
  } as unknown as Job<ReputationFeedbackExpiryJobData>;
}

describe('reputation feedback expiry worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the bounded expiry scan with the requested limit and returns its count', async () => {
    vi.mocked(expireReputationFeedbackRequests).mockResolvedValue(7);
    const now = new Date('2026-09-14T12:15:00.000Z');

    await expect(processReputationFeedbackExpiryJob(job({ limit: 25 }), now)).resolves.toEqual({
      expired: 7,
    });
    expect(expireReputationFeedbackRequests).toHaveBeenCalledWith({
      now,
      limit: 25,
    });
  });

  it('uses the service default when no limit is supplied', async () => {
    vi.mocked(expireReputationFeedbackRequests).mockResolvedValue(0);
    await expect(
      processReputationFeedbackExpiryJob(job(), new Date('2026-09-14T12:30:00.000Z')),
    ).resolves.toEqual({ expired: 0 });
    expect(expireReputationFeedbackRequests).toHaveBeenCalledWith({
      now: new Date('2026-09-14T12:30:00.000Z'),
      limit: undefined,
    });
  });
});
