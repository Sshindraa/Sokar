import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.unmock('bullmq');
vi.unmock('ioredis');
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const url = process.env.REDIS_INBOUND_REVIEW_TEST_URL;
if (url && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Inbound review tests require local Redis');
}

describe.skipIf(!url)('inbound review on Redis', () => {
  const connection = new Redis(url ?? 'redis://127.0.0.1:6379/14', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  const queue = new Queue(`inbound-audit-${randomUUID()}`, { connection });
  afterAll(async () => {
    if (url) await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  });

  it('deduplicates redeliveries while retaining separate opaque references by channel', async () => {
    vi.doMock('../../../shared/queue/queues', () => ({ queues: { deadLetter: queue } }));
    const { queueInboundReplyReview } = await import('../inbound-review');
    await Promise.all(
      Array.from({ length: 5 }, () => queueInboundReplyReview('sms', 'synthetic-message')),
    );
    await queueInboundReplyReview('whatsapp', 'synthetic-message');
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.data).toMatchObject({
        payloadVersion: 0,
        originalQueue: 'inbound-reply-review',
        originalJobId: 'synthetic-message',
        data: null,
      });
      expect(job.data.dataPreview).toMatchObject({
        provider: 'telnyx',
        providerMessageId: 'synthetic-message',
      });
    }
  });
});
