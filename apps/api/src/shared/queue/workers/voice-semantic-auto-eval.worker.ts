import { Worker } from 'bullmq';
import { runSemanticAutoEval } from '../../../modules/voice/stream/semantic-signals/auto-eval';
import { redisQueue } from '../../redis/client';
import { jobLogger, setupWorkerListeners } from './helper';

export const voiceSemanticAutoEvalWorker = new Worker(
  'voice-semantic-auto-eval',
  async (job) => {
    const log = jobLogger(job);
    const result = await runSemanticAutoEval();
    log.info({ status: result.status, turns: result.turns }, 'Weekly Jev auto-evaluation finished');
    return { status: result.status, turns: result.turns };
  },
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(voiceSemanticAutoEvalWorker);
