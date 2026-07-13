/**
 * Test du worker hold-cleanup (RES-008).
 * Vérifie que le worker appelle expireOverdue et retourne le nombre de holds expirés.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { HoldService } from '../core/hold.service';
import { processHoldCleanupJob } from '../workers/hold-cleanup.worker.js';

describe('hold-cleanup worker', () => {
  it('appelle expireOverdue et retourne le count', async () => {
    const holds = {
      expireOverdue: vi.fn().mockResolvedValue(5),
    } as unknown as HoldService;

    const job = {
      id: 'job-1',
      name: 'cleanup-expired-holds',
      queueName: 'hold-cleanup',
      attemptsMade: 0,
      data: {},
    } as unknown as Job;

    const result = await processHoldCleanupJob(job, holds);

    expect(holds.expireOverdue).toHaveBeenCalledWith(expect.any(Date));
    expect(result).toEqual({ expired: 5 });
  });

  it('retourne 0 si aucun hold expiré', async () => {
    const holds = {
      expireOverdue: vi.fn().mockResolvedValue(0),
    } as unknown as HoldService;

    const job = {
      id: 'job-2',
      name: 'cleanup-expired-holds',
      queueName: 'hold-cleanup',
      attemptsMade: 0,
      data: {},
    } as unknown as Job;

    const result = await processHoldCleanupJob(job, holds);

    expect(result).toEqual({ expired: 0 });
  });
});
