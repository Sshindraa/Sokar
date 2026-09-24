/**
 * Worker BullMQ — monitoring système pilote, toutes les 5 minutes.
 *
 * Complète le worker alert-evaluation (taux d'erreur HTTP/Connect) avec les
 * checks métier qui exigent la DB ou l'état des files :
 *   1. Files BullMQ inaccessibles / jobs failed / dead-letter / backlog
 *   2. Appels Telnyx sans transcription ou sans outcome (24h)
 *   3. Réservations confirmées sans SMS de confirmation tracé (24h)
 *
 * Chaque finding est dispatché via alert-dispatcher (logs + Sentry + email /
 * webhook / SMS selon la configuration ALERT_*) avec un cooldown Redis de
 * 30 min par (kind, identifier) — même mécanisme que alert-evaluation.
 *
 * Les compteurs lus sont aussi publiés en gauges Prometheus
 * (sokar_queue_jobs, sokar_calls_missing_transcript_24h,
 * sokar_reservations_missing_confirmation_sms_24h) pour un futur scraping.
 *
 * Hors scope volontairement (détecté par le watchdog VPS, impossible depuis
 * le process API) : API/dashboard down, arrêt total de Redis, backup
 * quotidien absent, disque/mémoire critiques.
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue, redisCache } from '../../redis/client';
import { db } from '../../db/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { logger } from '../../logger/pino';
import { dispatchAlert } from '../../observability/alert-dispatcher';
import { redisCooldown } from './alert-evaluation.worker';
import {
  queueJobsGauge,
  callsMissingTranscriptGauge,
  reservationsMissingSmsGauge,
} from '../../observability/metrics';
import { refreshVoiceReservationQualityMetrics } from '../../observability/voice-reservation-quality';
import {
  collectQueueStates,
  evaluateQueueStates,
  captureTelnyxWebhookSnapshot,
  evaluateTelnyxWebhookErrors,
  findCallsWithoutTranscript,
  evaluateCallsWithoutTranscript,
  findReservationsWithoutConfirmationSms,
  evaluateReservationsWithoutSms,
  type QueueStateCounts,
  type SystemFinding,
  type TelnyxWebhookSnapshot,
  DEAD_LETTER_BACKLOG_COOLDOWN_SECONDS,
} from '../../observability/system-checks';

export type SystemHealthJobData = Record<string, never>;

/**
 * Marqueur de démarrage du check SMS (clé Redis, TTL 30 jours). Les
 * réservations créées avant le premier tick n'ont pas d'audit d'envoi
 * possible — on ne les flague pas.
 */
const SMS_SINCE_KEY = 'sokar:system-health:sms-since';
const SMS_SINCE_TTL_SECONDS = 30 * 24 * 3600;

/** Snapshot précédent du compteur webhook Telnyx (fenêtre de 5 min). */
const WEBHOOK_SNAPSHOT_KEY = 'sokar:system-health:webhook-snapshot';
const WEBHOOK_SNAPSHOT_TTL_SECONDS = 900;
const DEAD_LETTER_BACKLOG_COOLDOWN_KEY = 'sokar:system-health:dead-letter-alerted-count';
const CLAIM_DEAD_LETTER_ALERT_SCRIPT = [
  'local previous = tonumber(redis.call("GET", KEYS[1]) or "-1")',
  'local current = tonumber(ARGV[1])',
  'if previous >= current then return 0 end',
  'redis.call("SET", KEYS[1], tostring(current), "EX", tonumber(ARGV[2]))',
  'return 1',
].join('\n');

async function claimDeadLetterBacklogAlert(count: number): Promise<boolean> {
  try {
    return (
      Number(
        await redisCache.eval(
          CLAIM_DEAD_LETTER_ALERT_SCRIPT,
          1,
          DEAD_LETTER_BACKLOG_COOLDOWN_KEY,
          count,
          DEAD_LETTER_BACKLOG_COOLDOWN_SECONDS,
        ),
      ) === 1
    );
  } catch (err) {
    // Keep the existing noisy-on-Redis-error behavior; the email dispatcher
    // independently enforces its daily cap.
    logger.warn({ err }, '[system-health] Dead-letter cooldown unavailable');
    return true;
  }
}

async function clearDeadLetterBacklogAlert(): Promise<void> {
  try {
    await redisCache.del(DEAD_LETTER_BACKLOG_COOLDOWN_KEY);
  } catch (err) {
    logger.warn({ err }, '[system-health] Failed to clear dead-letter cooldown');
  }
}

async function loadWebhookSnapshot(): Promise<TelnyxWebhookSnapshot | null> {
  try {
    const raw = await redisCache.get(WEBHOOK_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as TelnyxWebhookSnapshot) : null;
  } catch (err) {
    logger.warn({ err }, '[system-health] Failed to load webhook snapshot');
    return null;
  }
}

async function saveWebhookSnapshot(snapshot: TelnyxWebhookSnapshot): Promise<void> {
  try {
    await redisCache.set(
      WEBHOOK_SNAPSHOT_KEY,
      JSON.stringify(snapshot),
      'EX',
      WEBHOOK_SNAPSHOT_TTL_SECONDS,
    );
  } catch (err) {
    logger.warn({ err }, '[system-health] Failed to save webhook snapshot');
  }
}

async function getSmsSinceMarker(): Promise<Date> {
  const now = Date.now();
  try {
    const existing = await redisCache.get(SMS_SINCE_KEY);
    if (existing) return new Date(Number(existing));
    await redisCache.set(SMS_SINCE_KEY, String(now), 'EX', SMS_SINCE_TTL_SECONDS, 'NX');
    const stored = await redisCache.get(SMS_SINCE_KEY);
    return new Date(stored ? Number(stored) : now);
  } catch (err) {
    // Redis en erreur → on n'évalue pas le check SMS ce tick (prudent).
    logger.warn({ err }, '[system-health] Failed to read SMS since-marker, skipping SMS check');
    return new Date(now);
  }
}

/** Lit les compteurs de toutes les files ; null par file si Redis répond mal. */
function publishQueueGauges(states: Record<string, QueueStateCounts | null>): void {
  try {
    for (const [queue, counts] of Object.entries(states)) {
      for (const state of ['waiting', 'active', 'delayed', 'failed', 'paused'] as const) {
        queueJobsGauge.set({ queue, state }, counts?.[state] ?? 0);
      }
    }
  } catch (err) {
    logger.warn({ err }, '[system-health] Failed to publish queue gauges');
  }
}

async function dispatchFindings(
  findings: SystemFinding[],
  log: ReturnType<typeof jobLogger>,
): Promise<{ dispatched: number; suppressed: number }> {
  let dispatched = 0;
  let suppressed = 0;
  for (const finding of findings) {
    try {
      const isDeadLetterBacklog = finding.kind === 'dead_letter_backlog';
      const shouldDispatch = isDeadLetterBacklog
        ? typeof finding.deadLetterCount === 'number' &&
          (await claimDeadLetterBacklogAlert(finding.deadLetterCount))
        : !(await redisCooldown.shouldSuppress(finding.kind, finding.identifier));
      if (!shouldDispatch) {
        suppressed++;
        continue;
      }
      await dispatchAlert({
        kind: finding.kind,
        severity: finding.severity,
        summary: finding.summary,
        detail: finding.detail,
      });
      if (!isDeadLetterBacklog) {
        await redisCooldown.markFired(finding.kind, finding.identifier);
      }
      dispatched++;
    } catch (err) {
      // dispatchAlert ne throw pas ; sécurité supplémentaire pour le cooldown.
      log.error({ err, kind: finding.kind }, '[system-health] Failed to dispatch finding');
    }
  }
  return { dispatched, suppressed };
}

export const systemHealthWorker = new Worker(
  'system-health',
  async (job: Job<SystemHealthJobData>) => {
    const log = jobLogger(job);

    if (job.name === 'voice-quality-gauges') {
      try {
        const snapshot = await refreshVoiceReservationQualityMetrics(db);
        log.info(
          {
            reservationsCreated7d: snapshot.created7d,
            reservationsChangedAfterCall7d: snapshot.changedAfterCall7d,
            reservationsCancelledAfterCall7d: snapshot.cancelledAfterCall7d,
          },
          '[system-health] refreshed voice reservation quality gauges',
        );
        return { voiceQualityRefreshed: true };
      } catch (err) {
        log.error({ err }, '[system-health] Voice reservation quality snapshot failed');
        throw err;
      }
    }

    const findings: SystemFinding[] = [];

    // 1. Files BullMQ : inaccessibles, failed, dead-letter, backlog.
    const states = await collectQueueStates();
    publishQueueGauges(states);
    if (states['dead-letter']?.waiting === 0) {
      await clearDeadLetterBacklogAlert();
    }
    findings.push(...evaluateQueueStates(states));

    // 2. Webhooks Telnyx en erreur / rejetés (delta sur 5 min).
    try {
      const prevWebhook = await loadWebhookSnapshot();
      const curWebhook = await captureTelnyxWebhookSnapshot();
      const finding = evaluateTelnyxWebhookErrors(prevWebhook, curWebhook);
      if (finding) findings.push(finding);
      await saveWebhookSnapshot(curWebhook);
    } catch (err) {
      log.error({ err }, '[system-health] Telnyx webhook check failed');
    }

    // 3. Appels sans transcription / sans outcome.
    try {
      const calls = await findCallsWithoutTranscript(db);
      callsMissingTranscriptGauge.set(calls.length);
      const finding = evaluateCallsWithoutTranscript(calls);
      if (finding) findings.push(finding);
    } catch (err) {
      log.error({ err }, '[system-health] Calls check failed');
    }

    // 4. Réservations sans SMS de confirmation tracé.
    try {
      const since = await getSmsSinceMarker();
      const reservations = await findReservationsWithoutConfirmationSms(db, since);
      reservationsMissingSmsGauge.set(reservations.length);
      const finding = evaluateReservationsWithoutSms(reservations);
      if (finding) findings.push(finding);
    } catch (err) {
      log.error({ err }, '[system-health] Reservations SMS check failed');
    }

    const { dispatched, suppressed } = await dispatchFindings(findings, log);

    if (findings.length > 0) {
      log.warn(
        {
          findings: findings.map((f) => ({ kind: f.kind, severity: f.severity })),
          dispatched,
          suppressed,
        },
        `[system-health] ${findings.length} finding(s), ${dispatched} dispatched`,
      );
    } else {
      log.debug('[system-health] no findings');
    }

    return { findings: findings.length, dispatched, suppressed };
  },
  {
    connection: redisQueue,
    concurrency: 1,
  },
);

setupWorkerListeners(systemHealthWorker);
