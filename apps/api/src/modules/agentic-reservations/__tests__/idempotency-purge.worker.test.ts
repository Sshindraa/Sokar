/**
 * Test du worker idempotency-purge (RES-005).
 * Vérifie que le worker appelle deleteMany sur les records expirés
 * et retourne le nombre de lignes supprimées.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { processIdempotencyPurgeJob } from '../workers/idempotency-purge.worker.js';
import { db } from '../../../shared/db/client';

describe('idempotency-purge worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db as unknown as Record<string, unknown>, {
      idempotencyRecord: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
  });

  it('supprime les records expirés et retourne le count', async () => {
    vi.mocked(db.idempotencyRecord.deleteMany).mockResolvedValue({ count: 3 });

    const job = {
      id: 'job-1',
      name: 'purge-expired',
      queueName: 'idempotency-purge',
      attemptsMade: 0,
      data: {},
    } as unknown as Job;

    const result = await processIdempotencyPurgeJob(job);

    expect(db.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
    expect(result).toEqual({ deleted: 3 });
  });

  it('retourne 0 si aucun record expiré', async () => {
    const job = {
      id: 'job-2',
      name: 'purge-expired',
      queueName: 'idempotency-purge',
      attemptsMade: 0,
      data: {},
    } as unknown as Job;

    const result = await processIdempotencyPurgeJob(job);

    expect(result).toEqual({ deleted: 0 });
  });
});
