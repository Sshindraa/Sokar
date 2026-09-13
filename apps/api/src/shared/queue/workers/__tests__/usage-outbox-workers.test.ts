import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { db } from '../../../db/client';
import { queues } from '../../queues';
import { processOutboxDeliveryJob } from '../outbox-delivery.worker';
import { processOutboxDispatchJob } from '../outbox-dispatcher.worker';
import { processUsageRollupJob } from '../usage-rollup.worker';

function makeJob<T extends Record<string, unknown>>(data: T): Job<T> {
  return {
    data,
    id: 'test-job-1',
    name: 'test',
    queueName: 'test-queue',
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as unknown as Job<T>;
}

describe('usage and outbox workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.outboxEvent.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.outboxEvent.findMany).mockResolvedValue([]);
    vi.mocked(db.outboxEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.usageEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.usageEvent.create).mockResolvedValue({ id: 'usage-1' } as never);
    vi.mocked(db.usageTariff.findFirst).mockResolvedValue(null);
    vi.mocked(db.usageEvent.groupBy).mockResolvedValue([]);
    vi.mocked(db.usageMonthlyRollup.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.usageMonthlyRollup.create).mockResolvedValue({} as never);
  });

  it('publishes claimed IDs and acknowledges them only after BullMQ accepts the job', async () => {
    const event = { id: 'evt-1', createdAt: new Date() };
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([{ id: event.id }] as never);
    vi.mocked(db.outboxEvent.findMany).mockResolvedValueOnce([event] as never);

    await processOutboxDispatchJob(makeJob({ limit: 10 }));

    expect(queues.outboxDelivery.add).toHaveBeenCalledWith(
      'deliver',
      { outboxEventId: event.id },
      expect.objectContaining({ jobId: 'outbox_delivery_evt-1', attempts: 5 }),
    );
    expect(db.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: event.id, status: 'DISPATCHING' },
      data: {
        status: 'DISPATCHED',
        lockedAt: null,
        dispatchedAt: expect.any(Date),
        lastErrorCode: null,
      },
    });
  });

  it('rebuilds a usage event from an outbox payload with a real Date', async () => {
    vi.mocked(db.outboxEvent.findUnique).mockResolvedValueOnce({
      id: 'evt-usage-1',
      topic: 'usage',
      payload: {
        restaurantId: 'rest-1',
        category: 'STT_SECONDS',
        provider: 'elevenlabs',
        quantity: 2,
        unit: 'seconds',
        sourceType: 'voice_call',
        sourceId: 'leg-1',
        sourceEventKey: 'elevenlabs:stt:leg-1:final',
        occurredAt: '2026-09-13T12:00:00.000Z',
      },
    } as never);

    await processOutboxDeliveryJob(makeJob({ outboxEventId: 'evt-usage-1' }));

    expect(db.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        occurredAt: new Date('2026-09-13T12:00:00.000Z'),
        estimatedCost: new Prisma.Decimal('0.000000'),
      }),
    });
  });

  it('rebuilds the requested month for every requested restaurant', async () => {
    vi.mocked(db.usageEvent.groupBy).mockResolvedValueOnce([
      {
        category: 'STT_SECONDS',
        _sum: {
          quantity: new Prisma.Decimal('2'),
          estimatedCost: new Prisma.Decimal('0'),
        },
      },
    ] as never);

    await processUsageRollupJob(makeJob({ monthKey: '2026-09', restaurantId: 'rest-1' }));

    expect(db.usageEvent.groupBy).toHaveBeenCalledWith({
      by: ['category'],
      where: {
        restaurantId: 'rest-1',
        occurredAt: {
          gte: new Date('2026-09-01T00:00:00.000Z'),
          lt: new Date('2026-10-01T00:00:00.000Z'),
        },
      },
      _sum: { quantity: true, estimatedCost: true },
    });
    expect(db.usageMonthlyRollup.deleteMany).toHaveBeenCalledWith({
      where: { restaurantId: 'rest-1', monthKey: '2026-09' },
    });
    expect(db.usageMonthlyRollup.create).toHaveBeenCalledWith({
      data: {
        restaurantId: 'rest-1',
        monthKey: '2026-09',
        category: 'STT_SECONDS',
        quantity: new Prisma.Decimal('2'),
        estimatedCost: new Prisma.Decimal('0'),
      },
    });
  });
});
