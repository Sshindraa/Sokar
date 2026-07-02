/**
 * Worker BullMQ — évaluation périodique des alertes applicatives.
 *
 * Cron : toutes les 5 minutes (upsertJobScheduler dans main.ts).
 *
 * Flow à chaque tick :
 *   1. Capture le snapshot actuel des métriques (en mémoire, prom-client)
 *   2. Charge le snapshot précédent depuis Redis (clé sokar:alert:snapshot)
 *   3. Évalue les 4 alertes via evaluateAlerts() :
 *      - error_rate_high (5xx global API)
 *      - connect_5xx_rate_high (5xx routes Connect)
 *      - connect_latency_high (p95 par route Connect)
 *      - connect_queue_backlog (longueur queue connect-analytics)
 *   4. Sauvegarde le snapshot actuel dans Redis (TTL 15 min)
 *
 * Cooldown :
 *   Chaque alerte a un cooldown de 30 min en Redis (clé
 *   sokar:alert:cooldown:{kind}:{id}). Si le cooldown est actif, l'alerte
 *   est loggée mais pas envoyée à Sentry (évite le spam).
 *
 * Dégradation gracieuse :
 *   - Redis down (snapshot) → skip rate-based alerts, garde queue depth
 *   - Redis down (cooldown) → alerte sans dedup (mieux vaut noisy que silent)
 *   - Queue getJobCounts échoue → skip queue backlog alert
 *   - Process restart → detectedRestart() skip ce tick, nouvelle baseline
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { redisCache } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { queues } from '../queues';
import { logger } from '../../logger/pino';
import {
  captureSnapshot,
  evaluateAlerts,
  type MetricSnapshot,
  type AlertCooldown,
  type EvaluationResult,
} from '../../observability/alert-evaluator';

export type AlertEvaluationJobData = Record<string, never>;

// ─── Redis keys ────────────────────────────────────────────

const SNAPSHOT_KEY = 'sokar:alert:snapshot';
const COOLDOWN_KEY_PREFIX = 'sokar:alert:cooldown';
const SNAPSHOT_TTL_SECONDS = 900; // 15 min (3x la fenêtre de 5 min)
const COOLDOWN_TTL_SECONDS = 1800; // 30 min
const WINDOW_MIN = 5;

// ─── Snapshot store (Redis) ────────────────────────────────

async function loadPreviousSnapshot(): Promise<MetricSnapshot | null> {
  try {
    const raw = await redisCache.get(SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MetricSnapshot;
  } catch (err) {
    logger.warn({ err }, '[alert-evaluation] Failed to load previous snapshot from Redis');
    return null;
  }
}

async function saveSnapshot(snapshot: MetricSnapshot): Promise<void> {
  try {
    await redisCache.set(SNAPSHOT_KEY, JSON.stringify(snapshot), 'EX', SNAPSHOT_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, '[alert-evaluation] Failed to save snapshot to Redis');
  }
}

// ─── Cooldown store (Redis) ────────────────────────────────

const noopCooldown: AlertCooldown = {
  async shouldSuppress() {
    return false;
  },
  async markFired() {},
};

const redisCooldown: AlertCooldown = {
  async shouldSuppress(kind: string, identifier: string): Promise<boolean> {
    try {
      const key = `${COOLDOWN_KEY_PREFIX}:${kind}:${identifier}`;
      const exists = await redisCache.get(key);
      return exists !== null;
    } catch {
      // Redis down — on ne supprime pas (mieux vaut noisy que silent)
      return false;
    }
  },

  async markFired(kind: string, identifier: string): Promise<void> {
    try {
      const key = `${COOLDOWN_KEY_PREFIX}:${kind}:${identifier}`;
      await redisCache.set(key, String(Date.now()), 'EX', COOLDOWN_TTL_SECONDS);
    } catch {
      // Redis down — non bloquant, l'alerte a déjà été envoyée
    }
  },
};

// ─── Queue depth check ─────────────────────────────────────

async function getConnectQueueLength(): Promise<number | null> {
  try {
    const counts = await queues.connectAnalytics.getJobCounts('waiting', 'active', 'delayed');
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  } catch (err) {
    logger.warn({ err }, '[alert-evaluation] Failed to get connect-analytics queue length');
    return null;
  }
}

// ─── Worker ────────────────────────────────────────────────

export const alertEvaluationWorker = new Worker(
  'alert-evaluation',
  async (job: Job<AlertEvaluationJobData>) => {
    const log = jobLogger(job);

    // 1. Capture le snapshot actuel (en mémoire — toujours disponible)
    const curSnapshot = await captureSnapshot();

    // 2. Charge le snapshot précédent (Redis — peut échouer)
    const prevSnapshot = await loadPreviousSnapshot();

    // 3. Longueur de la queue connect-analytics (BullMQ — peut échouer)
    const queueLength = await getConnectQueueLength();

    // 4. Évalue les alertes
    const result: EvaluationResult = await evaluateAlerts({
      prevSnapshot,
      curSnapshot,
      queueLength,
      cooldown: redisCooldown,
      windowMin: WINDOW_MIN,
    });

    // 5. Sauvegarde le snapshot actuel pour le prochain tick
    await saveSnapshot(curSnapshot);

    // 6. Log structuré
    const triggered = result.alerts.filter((a) => a.triggered);
    const suppressed = result.alerts.filter((a) => a.suppressed);
    if (triggered.length > 0) {
      log.warn(
        {
          triggered: triggered.map((a) => ({ kind: a.kind, detail: a.detail })),
          suppressed: suppressed.map((a) => a.kind),
          baselineReset: result.baselineReset,
          errors: result.errors,
        },
        `[alert-evaluation] ${triggered.length} alert(s) triggered`,
      );
    } else {
      log.debug(
        {
          alerts: result.alerts.length,
          baselineReset: result.baselineReset,
          queueLength,
          errors: result.errors,
        },
        '[alert-evaluation] no alerts triggered',
      );
    }

    return result;
  },
  {
    connection: redisQueue,
    concurrency: 1, // Pas de parallélisme — une évaluation à la fois
  },
);

setupWorkerListeners(alertEvaluationWorker);

// Re-export pour les tests
export { noopCooldown, redisCooldown, loadPreviousSnapshot, saveSnapshot };
