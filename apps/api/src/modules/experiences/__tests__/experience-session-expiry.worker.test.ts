import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { expireExperienceSessions } from '../experience.service';
import {
  processExperienceSessionExpiryJob,
  type ExperienceSessionExpiryJobData,
} from '../experience-session-expiry.worker';

vi.mock('../experience.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../experience.service')>();
  return { ...actual, expireExperienceSessions: vi.fn() };
});

function job(data: ExperienceSessionExpiryJobData = {}): Job<ExperienceSessionExpiryJobData> {
  return {
    id: 'experience-expiry-1',
    name: 'scan',
    data,
  } as unknown as Job<ExperienceSessionExpiryJobData>;
}

describe('experience session expiry worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs a bounded expiry scan and returns its count', async () => {
    vi.mocked(expireExperienceSessions).mockResolvedValue(7);
    const now = new Date('2026-09-14T12:15:00.000Z');
    await expect(processExperienceSessionExpiryJob(job({ limit: 25 }), now)).resolves.toEqual({
      expired: 7,
    });
    expect(expireExperienceSessions).toHaveBeenCalledWith({ now, limit: 25 });
  });

  it('uses the service default when no limit is supplied', async () => {
    vi.mocked(expireExperienceSessions).mockResolvedValue(0);
    const now = new Date('2026-09-14T12:30:00.000Z');
    await expect(processExperienceSessionExpiryJob(job(), now)).resolves.toEqual({ expired: 0 });
    expect(expireExperienceSessions).toHaveBeenCalledWith({ now, limit: undefined });
  });
});
