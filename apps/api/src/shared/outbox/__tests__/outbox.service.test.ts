import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/client';
import { claimPending, enqueue } from '../outbox.service';

const INPUT = {
  restaurantId: 'rest-1',
  topic: 'usage',
  aggregateType: 'call',
  aggregateId: 'leg-1',
  eventType: 'usage.record',
  payload: { category: 'STT_SECONDS', quantity: 2 },
  idempotencyKey: 'elevenlabs:stt:leg-1:final',
};

describe('transactional outbox service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a durable event and treats the same payload as a replay', async () => {
    const event = { id: 'evt-1', ...INPUT, schemaVersion: 1, restaurantId: 'rest-1' };
    vi.mocked(db.outboxEvent.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(event as never);
    vi.mocked(db.outboxEvent.create).mockResolvedValue(event as never);

    await expect(enqueue(db, INPUT)).resolves.toMatchObject({ created: true });
    await expect(enqueue(db, INPUT)).resolves.toMatchObject({ created: false, event });
    expect(db.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it('rejects obvious PII fields before they enter Postgres or Redis', async () => {
    await expect(
      enqueue(db, { ...INPUT, payload: { customerPhone: '+33123456789' } }),
    ).rejects.toThrow('forbidden field');
    expect(db.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('claims pending rows through the PostgreSQL SKIP LOCKED statement', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([{ id: 'evt-1' }] as never);
    vi.mocked(db.outboxEvent.findMany).mockResolvedValueOnce([{ id: 'evt-1' }] as never);

    await expect(claimPending(10, new Date('2026-09-13T12:00:00.000Z'))).resolves.toEqual([
      { id: 'evt-1' },
    ]);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
  });
});
