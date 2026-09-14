import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { processEventSessionExpiryJob } from '../event-session-expiry.worker';

describe('event session expiry worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('closes bounded sessions and returns the count', async () => {
    vi.mocked(db.eventSession.findMany).mockResolvedValue([{ id: 'session-1' }] as never);
    vi.mocked(db.eventSession.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.eventWaitlistEntry.updateMany).mockResolvedValue({ count: 2 } as never);
    const result = await processEventSessionExpiryJob({
      id: 'job-1',
      data: { limit: 25 },
    } as never);
    expect(result).toEqual({ closed: 1 });
    expect(db.eventWaitlistEntry.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not write when no session is due', async () => {
    vi.mocked(db.eventSession.findMany).mockResolvedValue([] as never);
    const result = await processEventSessionExpiryJob({
      id: 'job-2',
      data: { limit: 25 },
    } as never);
    expect(result).toEqual({ closed: 0 });
    expect(db.eventSession.updateMany).not.toHaveBeenCalled();
  });
});
