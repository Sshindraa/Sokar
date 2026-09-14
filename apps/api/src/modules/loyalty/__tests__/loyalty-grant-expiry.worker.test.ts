import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { processLoyaltyGrantExpiryJob } from '../loyalty-grant-expiry.worker';

describe('loyalty grant expiry worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('expires a bounded batch without a provider call', async () => {
    vi.mocked(db.loyaltyGrant.findMany).mockResolvedValue([{ id: 'grant-1' }] as never);
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await processLoyaltyGrantExpiryJob(
      { data: { limit: 25 } } as never,
      new Date('2026-09-14T10:00:00.000Z'),
    );

    expect(result).toEqual({ expired: 1 });
    expect(db.loyaltyGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
  });

  it('returns zero when no grant is due', async () => {
    vi.mocked(db.loyaltyGrant.findMany).mockResolvedValue([]);
    await expect(processLoyaltyGrantExpiryJob({ data: { limit: 25 } } as never)).resolves.toEqual({
      expired: 0,
    });
    expect(db.loyaltyGrant.updateMany).not.toHaveBeenCalled();
  });
});
