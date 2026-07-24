import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';
import {
  purgeExpiredRecordings,
  recoverPendingRecording,
  storeSavedRecording,
  type RecoverRecordingJobData,
  type SavedRecordingJobData,
} from '../../../modules/voice/call-recording.service';
import { db } from '../../db/client';

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

    if (job.name === 'store-recording') {
      const data = job.data as SavedRecordingJobData;
      try {
        await storeSavedRecording(data);
        log.info(
          { callLegId: data.callLegId, recordingId: data.recordingId },
          'Telnyx recording stored privately',
        );
      } catch (err) {
        await db.call.updateMany({
          where: { callSid: data.callLegId },
          data: {
            recordingStatus: 'FAILED',
            recordingError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          },
        });
        throw err;
      }
      return;
    }

    if (job.name === 'purge-expired-recordings') {
      await purgeExpiredRecordings();
      return;
    }

    if (job.name === 'recover-recording') {
      await recoverPendingRecording(job.data as RecoverRecordingJobData);
      return;
    }

    const data = job.data as TelnyxAnswerJobData;
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    const telnyxBaseUrl = process.env.TELNYX_API_URL ?? 'https://api.telnyx.com';
    const res = await fetch(`${telnyxBaseUrl}/v2/calls/${data.callControlId}/actions/answer`, {
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
    });

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
