import { createHash } from 'node:crypto';
import { queues } from '../../shared/queue/queues';

export async function queueInboundReplyReview(channel: 'sms' | 'whatsapp', messageId: string) {
  if (!messageId || messageId.length > 256) throw new Error('Invalid provider message ID');
  const fingerprint = createHash('sha256').update(`${channel}:${messageId}`).digest('hex');
  await queues.deadLetter.add(
    'inbound-reply-review',
    {
      payloadVersion: 0,
      originalQueue: 'inbound-reply-review',
      originalJobName: channel,
      originalJobId: messageId,
      attemptsMade: 0,
      failedReason: 'Reservation not identified; manual review required',
      data: null,
      dataPreview: { provider: 'telnyx', channel, providerMessageId: messageId },
      failedAt: new Date().toISOString(),
    },
    { jobId: `inbound_reply_review_${fingerprint}` },
  );
}
