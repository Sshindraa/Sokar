import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';

export interface TelnyxAnswerJobData {
  readonly callControlId: string;
  readonly callLegId: string;
  readonly streamUrl: string;
  readonly codec: 'PCMA' | 'PCMU';
  readonly idempotencyKey: string;
}

export const telnyxWebhookWorker = new Worker(
  'telnyx-webhooks',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as TelnyxAnswerJobData;
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    const res = await fetch(
      `https://api.telnyx.com/v2/calls/${data.callControlId}/actions/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': data.idempotencyKey,
        },
        body: JSON.stringify({
          stream_url: data.streamUrl,
          stream_track: 'inbound_track',
          stream_bidirectional_mode: 'rtp',
          stream_bidirectional_codec: data.codec,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telnyx answer failed: ${res.status} ${body.slice(0, 500)}`);
    }

    log.info(
      { callControlId: data.callControlId, callLegId: data.callLegId },
      'Telnyx call answered',
    );
  },
  { connection: redisQueue, concurrency: 5 },
);

setupWorkerListeners(telnyxWebhookWorker);
