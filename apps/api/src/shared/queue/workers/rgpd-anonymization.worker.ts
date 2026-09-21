/**
 * Worker d'anonymisation RGPD (rétention 2 ans).
 *
 * La logique vit dans `modules/rgpd/anonymization.service.ts`. Le worker est
 * câblé et planifié, mais l'exécution reste fermée par défaut :
 * `RGPD_ANONYMIZATION_ENABLED=false`. L'opération est destructive et n'a jamais
 * tourné en production — l'activer demande une validation explicite du prédicat
 * de rétention et une revue juridique.
 */

import { Worker } from 'bullmq';
import { db } from '../../db/client';
import { env } from '../../../env';
import { logger } from '../../logger/pino';
import { redisQueue } from '../../redis/client';
import { runAnonymization } from '../../../modules/rgpd/anonymization.service';
import { jobLogger, setupWorkerListeners } from './helper';

export const rgpdAnonymizationWorker = new Worker(
  'rgpd-anonymization',
  async (job) => {
    const log = jobLogger(job);

    if (env.RGPD_ANONYMIZATION_ENABLED !== 'true') {
      log.info('rgpd anonymization disabled — job skipped');
      return { skipped: true };
    }

    const result = await runAnonymization(db);
    log.info(result, 'rgpd anonymization completed');
    logger.info({ ...result }, '[rgpd-anonymization] retention run');
    return result;
  },
  {
    connection: redisQueue,
    concurrency: 1,
  },
);

setupWorkerListeners(rgpdAnonymizationWorker);
