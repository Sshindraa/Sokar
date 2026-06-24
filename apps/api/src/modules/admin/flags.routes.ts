/**
 * Routes admin — visibilité sur les feature flags ConfigCat.
 *
 * GET /admin/flags  : retourne l'état effectif des flags pour le restaurant
 *                     courant (celui dérivé du Clerk orgId). Utile pour le
 *                     dashboard interne et le débogage (voir immédiatement
 *                     si le kill switch voice est off, si un override de plan
 *                     est appliqué, etc.) sans avoir à ouvrir le dashboard
 *                     ConfigCat.
 *
 * Note : ConfigCat n'est pas une source de vérité modifiable depuis cette
 * route — c'est volontairement read-only. Les overrides se font depuis
 * https://app.configcat.com. Cette route ne fait qu'exposer ce que le SDK
 * résoudrait à l'instant T pour ce restaurant, en fail-open par défaut.
 *
 * Auth : requireOrg() (Clerk). L'actor pour audit = `${userId}:${restaurantId}`.
 */

import { FastifyInstance } from 'fastify';
import { requireOrg } from '../../plugins/clerk';
import { db } from '../../shared/db/client';
import {
  FLAGS,
  FlagKey,
  isVoicePipelineEnabled,
  getRestaurantPlanOverride,
  isFlagEnabled,
  rolloutBucket,
} from '../../shared/configcat';

interface BooleanFlagEntry {
  readonly key: string;
  readonly enabled: boolean;
}

interface FlagsResponse {
  readonly restaurantId: string;
  readonly sdkConfigured: boolean;
  readonly rolloutBucket: number;
  readonly voicePipeline: {
    readonly enabled: boolean;
    readonly flagKey: string;
  };
  readonly plan: {
    readonly dbPlan: string | null;
    readonly override: string | null;
    readonly effective: string | null;
    readonly flagKey: string;
  };
  readonly booleans: readonly BooleanFlagEntry[];
  readonly evaluatedAt: string;
}

// Flags booléens exposés à l'UI. On évite d'exposer RESTAURANT_PLAN (string)
// et les flags de rollout interne (gérés via plan.override / rolloutBucket).
const EXPOSED_BOOLEAN_FLAGS: readonly FlagKey[] = [
  FLAGS.SPECULATIVE_LLM,
  FLAGS.VIP_ALERTS,
  FLAGS.NEW_FILLER_SYSTEM,
  FLAGS.OUTBOUND_CONFIRMATION,
];

export async function flagsRoutes(app: FastifyInstance) {
  app.get('/admin/flags', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    // DB plan — lu à la demande, pas caché (ce endpoint n'est pas un hot path).
    // Si la lecture échoue, on ne fait pas échouer tout l'endpoint : on retourne
    // simplement `dbPlan: null` et l'override (qui est l'info la plus utile).
    let dbPlan: string | null = null;
    try {
      const row = await db.restaurant.findUnique({
        where: { id: restaurantId },
        select: { plan: true },
      });
      dbPlan = row?.plan ?? null;
    } catch (err) {
      req.log.warn({ err, restaurantId }, 'flags.routes: failed to read db plan');
    }

    const [voiceEnabled, booleanFlags] = await Promise.all([
      isVoicePipelineEnabled(restaurantId),
      Promise.all(
        EXPOSED_BOOLEAN_FLAGS.map(async (key) => ({
          key,
          enabled: await isFlagEnabled(key, restaurantId, false),
        })),
      ),
    ]);

    // Plan override : uniquement si on a un plan DB. Sinon l'override n'a pas
    // de sens (on ne sait pas quoi comparer). Le champ effectif reste null.
    const planOverride =
      dbPlan !== null ? await getRestaurantPlanOverride(restaurantId, dbPlan) : null;
    const effectivePlan = planOverride;

    const response: FlagsResponse = {
      restaurantId,
      sdkConfigured: Boolean(process.env.CONFIGCAT_SDK_KEY),
      rolloutBucket: rolloutBucket(restaurantId),
      voicePipeline: {
        enabled: voiceEnabled,
        flagKey: FLAGS.VOICE_PIPELINE_ENABLED,
      },
      plan: {
        dbPlan,
        override: dbPlan !== null && planOverride !== dbPlan ? planOverride : null,
        effective: effectivePlan,
        flagKey: FLAGS.RESTAURANT_PLAN,
      },
      booleans: booleanFlags,
      evaluatedAt: new Date().toISOString(),
    };

    return reply.send(response);
  });
}
