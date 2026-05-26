/**
 * ConfigCat — Feature flags client.
 *
 * Utilisation :
 *   import { getFlag, isFlagEnabled, FLAGS } from './shared/configcat';
 *   if (await isFlagEnabled(FLAGS.SPECULATIVE_LLM, restaurantId)) { ... }
 *
 * Dashboard : https://app.configcat.com
 * SDK doc   : https://configcat.com/docs/sdk-reference/node
 */
import * as configcat from 'configcat-node';
import type { IConfigCatClient, User } from 'configcat-node';

let client: IConfigCatClient | null = null;

function getClient(): IConfigCatClient | null {
  if (!client) {
    const sdkKey = process.env.CONFIGCAT_SDK_KEY;
    if (!sdkKey) {
      return null;
    }
    client = configcat.getClient(sdkKey, configcat.PollingMode.AutoPoll, {
      pollIntervalSeconds: 60,
      setupHooks: (hooks) => {
        hooks.on('clientReady', () => {
          console.log('[configcat] Client ready');
        });
        hooks.on('configChanged', () => {
          console.log('[configcat] Config changed');
        });
      },
    });
  }
  return client;
}

function buildUser(restaurantId?: string): User {
  return {
    identifier: restaurantId ?? 'default',
    custom: {},
  };
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
    console.error(`[configcat] Error getting flag "${flagKey}":`, err);
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
    return await c.getValueAsync(flagKey, defaultValue, buildUser(restaurantId)) as T;
  } catch (err) {
    console.error(`[configcat] Error getting flag "${flagKey}":`, err);
    return defaultValue;
  }
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
  /** Plan tarifaire du restaurant (Starter/Pro/Premium) */
  RESTAURANT_PLAN: 'restaurant_plan',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];
