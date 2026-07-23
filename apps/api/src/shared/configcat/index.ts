/**
 * ConfigCat — Feature flags client.
 *
 * Utilisation :
 *   import { getFlag, isFlagEnabled, FLAGS, isVoicePipelineEnabled,
 *            getRestaurantPlanOverride, isInRollout } from './shared/configcat';
 *
 *   if (!(await isVoicePipelineEnabled(ctx.id))) { return; } // kill switch
 *   const plan = await getRestaurantPlanOverride(ctx.id, ctx.plan);
 *   if (await isInRollout('new_filler_system_v2', ctx.id, 25)) { ... }
 *
 * Dashboard : https://app.configcat.com
 * SDK doc   : https://configcat.com/docs/sdk-reference/node
 *
 * ## Failure modes
 *  - SDK key absent (CONFIGCAT_SDK_KEY not set) → `null` client, every call
 *    returns its declared default. Use this in dev/test or pre-prod.
 *  - Network/SDK error → caught, default returned, error logged.
 *  - Cache key absent → ConfigCat's local cache (60s polling) is the source
 *    of truth; we do not double-cache.
 */
import * as configcat from 'configcat-node';
import type { IConfigCatClient, User } from 'configcat-node';
import { createHash } from 'crypto';
import { logger } from '../logger/pino';

let client: IConfigCatClient | null = null;

function getClient(): IConfigCatClient | null {
  if (client) return client;

  const sdkKey = process.env.CONFIGCAT_SDK_KEY;
  if (!sdkKey) {
    return null;
  }

  client = configcat.getClient(sdkKey, configcat.PollingMode.AutoPoll, {
    pollIntervalSeconds: 60,
    setupHooks: (hooks) => {
      hooks.on('clientReady', () => {
        logger.info('[configcat] Client ready');
      });
      hooks.on('configChanged', () => {
        logger.info('[configcat] Config changed');
      });
    },
  });
  return client;
}

function buildUser(restaurantId?: string): User {
  return {
    identifier: restaurantId ?? 'default',
    custom: restaurantId ? { restaurantId } : {},
  };
}

/**
 * Stable 0–99 bucket for `restaurantId`. Same input → same bucket across
 * processes and restarts. Use with percentage-based rollouts so a given
 * restaurant consistently lands inside or outside the rollout.
 */
export function rolloutBucket(restaurantId: string): number {
  const digest = createHash('sha256').update(restaurantId).digest();
  // First 4 bytes as unsigned int, modulo 100 → 0..99
  return digest.readUInt32BE(0) % 100;
}

/**
 * Returns true if `restaurantId` lands in the first `percentage` percent
 * of the bucket space. `percentage` is clamped to [0, 100].
 */
export function isInRollout(restaurantId: string, percentage: number): boolean {
  const pct = Math.max(0, Math.min(100, percentage));
  if (pct === 0) return false;
  if (pct === 100) return true;
  return rolloutBucket(restaurantId) < pct;
}

/**
 * Vérifie si une flag booléenne est activée pour un restaurant donné.
 */
export async function isFlagEnabled(
  flagKey: string,
  restaurantId?: string,
  defaultValue = false,
): Promise<boolean> {
  const c = getClient();
  if (!c) return defaultValue;
  try {
    return await c.getValueAsync(flagKey, defaultValue, buildUser(restaurantId));
  } catch (err) {
    logger.error({ err }, `[configcat] Error getting flag "${flagKey}"`);
    return defaultValue;
  }
}

/**
 * Récupère une valeur de flag typée.
 */
export async function getFlag<T extends string | number | boolean>(
  flagKey: string,
  defaultValue: T,
  restaurantId?: string,
): Promise<T> {
  const c = getClient();
  if (!c) return defaultValue;
  try {
    return (await c.getValueAsync(flagKey, defaultValue, buildUser(restaurantId))) as T;
  } catch (err) {
    logger.error({ err }, `[configcat] Error getting flag "${flagKey}"`);
    return defaultValue;
  }
}

// ---------------------------------------------------------------------------
// Semantic helpers — domain-specific wrappers used in handlers/services.
// They are fail-open (defaults preserve current behavior) unless the flag
// name itself implies the opposite.
// ---------------------------------------------------------------------------

/**
 * Kill switch for the voice pipeline. Default `true` (enabled). Toggle
 * the flag OFF in the dashboard to drop incoming calls gracefully — they
 * will hit Telnyx's voicemail/fallback. Always evaluate before doing any
 * expensive work (DB write, queue enqueue, session create).
 */
export async function isVoicePipelineEnabled(restaurantId?: string): Promise<boolean> {
  return isFlagEnabled(FLAGS.VOICE_PIPELINE_ENABLED, restaurantId, true);
}

/**
 * Canary TTS Cartesia : désactivé sans configuration ConfigCat explicite.
 * Le pipeline appelle aussi le switch env global, ce flag ne peut donc pas
 * activer Context V2 seul sur toute la flotte.
 */
export async function isVoiceTtsContextV2Enabled(restaurantId: string): Promise<boolean> {
  return isFlagEnabled(FLAGS.VOICE_TTS_CONTEXT_V2, restaurantId, false);
}

/**
 * Reads the `restaurant_plan` flag (string). If set, the flag value
 * overrides the `plan` column from the DB. Allowed values:
 * `STARTER | PRO | PREMIUM`. Any other string is ignored and the DB plan
 * is preserved (don't crash on a misconfigured dashboard).
 */
export async function getRestaurantPlanOverride(
  restaurantId: string,
  dbPlan: string,
): Promise<string> {
  const override = await getFlag<string>(FLAGS.RESTAURANT_PLAN, '', restaurantId);
  if (override && isValidPlan(override)) {
    return override;
  }
  return dbPlan;
}

const VALID_PLANS = new Set(['STARTER', 'PRO', 'PREMIUM']);
function isValidPlan(value: string): boolean {
  return VALID_PLANS.has(value);
}

/**
 * Progressive rollout for a plan upgrade. Use when you want to push a
 * restaurant onto a higher plan for a subset of the fleet (e.g. trial).
 * `percentage` is the rollout size; same restaurant always gets the
 * same answer (deterministic hash bucket).
 */
export async function isPlanRolloutActive(
  restaurantId: string,
  percentage: number,
): Promise<boolean> {
  return isInRollout(restaurantId, percentage);
}

/**
 * Combination of flag AND bucket — convenient when the dashboard exposes
 * a boolean ON/OFF toggle but you also want server-side capping while
 * rolling out (defence in depth).
 */
export async function isFlagEnabledWithRollout(
  flagKey: string,
  restaurantId: string,
  percentage: number,
  defaultValue = false,
): Promise<boolean> {
  const flag = await isFlagEnabled(flagKey, restaurantId, defaultValue);
  if (!flag) return false;
  return isInRollout(restaurantId, percentage);
}

/**
 * Liste des flags utilisés dans Sokar.
 * Ajouter chaque nouveau flag ici + dans le dashboard ConfigCat.
 */
export const FLAGS = {
  /** Kill switch général du pipeline vocal */
  VOICE_PIPELINE_ENABLED: 'voice_pipeline_enabled',
  /** Activation du LLM spéculatif (optimisation latence) */
  SPECULATIVE_LLM: 'speculative_llm',
  /** Alertes SMS VIP */
  VIP_ALERTS: 'vip_alerts',
  /** Nouveau système de fillers */
  NEW_FILLER_SYSTEM: 'new_filler_system',
  /** Outbound : appels sortants de confirmation */
  OUTBOUND_CONFIRMATION: 'outbound_confirmation',
  /** Plan tarifaire du restaurant (STARTER/PRO/PREMIUM) — override dashboard */
  RESTAURANT_PLAN: 'restaurant_plan',
  /** Active la nouvelle logique de remplissage de silence v2 (rollout 25%) */
  NEW_FILLER_SYSTEM_V2: 'new_filler_system_v2',
  /** Canary de continuité prosodique Cartesia WebSocket par restaurant */
  VOICE_TTS_CONTEXT_V2: 'voice_tts_context_v2',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];
