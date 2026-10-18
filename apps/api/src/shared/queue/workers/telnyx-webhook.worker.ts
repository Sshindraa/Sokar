import { Worker } from 'bullmq';
import { telnyxFetch } from '../../telnyx/http-agent';
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
import { purgeExpiredVoiceDebugTurns } from '../../../modules/voice/stream/debug-dialogue';
import { buildTelnyxStreamConfig } from '../../../modules/voice/stream/telnyx-codec';
import {
  CALL_REPORT_JOB_NAME,
  enqueueCallReport,
  runCallReportJob,
} from '../../../modules/voice/call-report/job-runtime';
import { queues } from '../queues';

export interface TelnyxAnswerJobData {
  readonly callControlId: string;
  readonly callLegId: string;
  readonly streamUrl: string;
  readonly codec: 'PCMA' | 'PCMU' | 'L16';
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
        // Rapport automatique de l'appel (désactivé par défaut) : mis en file, jamais bloquant.
        await enqueueCallReport(data.callLegId, queues.telnyxWebhooks);
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

    if (job.name === 'purge-expired-voice-debug-turns') {
      const deleted = await purgeExpiredVoiceDebugTurns();
      log.info({ deleted }, 'Expired voice debug turns purged');
      return;
    }

    if (job.name === 'recover-recording') {
      const recovery = job.data as RecoverRecordingJobData;
      await recoverPendingRecording(recovery);
      await enqueueCallReport(recovery.callLegId, queues.telnyxWebhooks);
      return;
    }

    if (job.name === CALL_REPORT_JOB_NAME) {
      // Ne lève jamais : un rapport manquant n'a pas d'effet sur le reste.
      await runCallReportJob((job.data as { callLegId: string }).callLegId);
      return;
    }

    const data = job.data as TelnyxAnswerJobData;
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    const res = await telnyxFetch(`/v2/calls/${data.callControlId}/actions/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Idempotency-Key': data.idempotencyKey,
      },
      body: JSON.stringify(buildTelnyxStreamConfig(data.streamUrl, data.codec)),
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
