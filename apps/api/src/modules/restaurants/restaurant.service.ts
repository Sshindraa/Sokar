import { db } from '../../shared/db/client';
import { getCachedContext, setCachedContext, redisCache } from '../../shared/redis/client';
import * as Sentry from '@sentry/node';
import {
  CARTESIA_MODEL,
  CIRCUIT_BREAKER_HOURLY_LIMIT,
  DEFAULT_CARTESIA_VOICE_ID,
  INTERNAL_CALL_ALERT_THRESHOLD,
  VOICE_LLM_MODEL_DEFAULT,
  REDIS_CTX_TTL_SECONDS,
} from '@sokar/config';
import { getRestaurantPlanOverride } from '../../shared/configcat';

interface SafeProviderConfig {
  readonly carrier: string;
  readonly sttProvider: 'deepgram';
  readonly sttModel: string;
  readonly llmProvider: 'openrouter';
  readonly llmModel: string;
  readonly ttsProvider: 'cartesia';
  readonly ttsModel: string;
  readonly voiceId: string;
}

interface CachedRestaurantContext {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly managerPhone: string;
  readonly managerEmail: string;
  readonly phoneNumber: string;
  readonly openingHours: unknown;
  readonly carrier: string;
  readonly smsConfirmEnabled: boolean;
  readonly googleCalendarId: string | null;
  readonly personality: {
    readonly id: string;
    readonly restaurantId: string;
    readonly profileType: string;
    readonly speakingRate: unknown;
    readonly pitchShift: unknown;
    readonly fillerStyle: string;
    readonly microphoneThreshold: number;
    readonly targetLatencyMs: number;
    readonly systemPromptExtra: string | null;
    readonly voiceIdCa: string | null;
    readonly updatedAt: Date;
  } | null;
  readonly providerConfig: SafeProviderConfig;
}

function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getHourKey() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
}

function buildProviderConfig(restaurant: {
  carrier: string;
  personality: { voiceIdCa: string | null } | null;
}): SafeProviderConfig {
  return {
    carrier: restaurant.carrier,
    sttProvider: 'deepgram',
    sttModel: process.env.DEEPGRAM_MODEL ?? 'nova-3',
    llmProvider: 'openrouter',
    llmModel: process.env.VOICE_LLM_MODEL ?? VOICE_LLM_MODEL_DEFAULT,
    ttsProvider: 'cartesia',
    ttsModel: CARTESIA_MODEL,
    voiceId:
      restaurant.personality?.voiceIdCa ??
      process.env.CARTESIA_VOICE_ID ??
      DEFAULT_CARTESIA_VOICE_ID,
  };
}

function toCachedRestaurantContext(restaurant: {
  id: string;
  name: string;
  plan: string;
  managerPhone: string;
  managerEmail: string;
  phoneNumber: string;
  openingHours: unknown;
  carrier: string;
  smsConfirmEnabled: boolean;
  googleCalendarId: string | null;
  personality: CachedRestaurantContext['personality'];
}): CachedRestaurantContext {
  return {
    id: restaurant.id,
    name: restaurant.name,
    plan: restaurant.plan,
    managerPhone: restaurant.managerPhone,
    managerEmail: restaurant.managerEmail,
    phoneNumber: restaurant.phoneNumber,
    openingHours: restaurant.openingHours,
    carrier: restaurant.carrier,
    smsConfirmEnabled: restaurant.smsConfirmEnabled,
    googleCalendarId: restaurant.googleCalendarId,
    personality: restaurant.personality,
    providerConfig: buildProviderConfig(restaurant),
  };
}

export async function invalidateRestaurantContextCache(phoneNumber: string | null | undefined) {
  if (!phoneNumber) return;
  await redisCache.del(`phone:${phoneNumber}`);
}

export class RestaurantService {
  static async loadContext(phoneNumberId: string): Promise<CachedRestaurantContext> {
    const cacheKey = `phone:${phoneNumberId}`;
    const cached = await getCachedContext(cacheKey);
    if (cached) return cached as CachedRestaurantContext;

    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { phoneNumber: phoneNumberId },
      select: {
        id: true,
        name: true,
        plan: true,
        managerPhone: true,
        managerEmail: true,
        phoneNumber: true,
        openingHours: true,
        carrier: true,
        smsConfirmEnabled: true,
        googleCalendarId: true,
        personality: {
          select: {
            id: true,
            restaurantId: true,
            profileType: true,
            speakingRate: true,
            pitchShift: true,
            fillerStyle: true,
            microphoneThreshold: true,
            targetLatencyMs: true,
            systemPromptExtra: true,
            voiceIdCa: true,
            updatedAt: true,
          },
        },
      },
    });
    const context = toCachedRestaurantContext(restaurant);

    // Apply plan override from ConfigCat. Fail-open: if SDK is absent or the
    // dashboard returns an invalid value, the DB plan is preserved.
    const effectivePlan = await getRestaurantPlanOverride(restaurant.id, context.plan);
    const contextWithPlan =
      effectivePlan === context.plan ? context : { ...context, plan: effectivePlan };

    await setCachedContext(cacheKey, contextWithPlan, REDIS_CTX_TTL_SECONDS);
    return contextWithPlan;
  }

  static async checkMarginHealth(restaurantId: string): Promise<boolean> {
    const monthKey = getCurrentMonthKey();
    const countKey = `infra:calls:${restaurantId}:${monthKey}`;
    const count = await redisCache.incr(countKey);
    if (count === 1) await redisCache.expire(countKey, 33 * 24 * 3600);

    if (count > INTERNAL_CALL_ALERT_THRESHOLD) {
      Sentry.captureMessage(`[MARGIN] Restaurant ${restaurantId} atteint ${count} appels ce mois`, {
        level: 'warning',
        tags: { restaurantId, monthKey },
      });
    }

    const hourKey = `infra:calls:${restaurantId}:${getHourKey()}`;
    const hourCount = await redisCache.incr(hourKey);
    if (hourCount === 1) await redisCache.expire(hourKey, 3600);

    if (hourCount > CIRCUIT_BREAKER_HOURLY_LIMIT) {
      Sentry.captureMessage(
        `[CIRCUIT_BREAKER] Restaurant ${restaurantId}: ${hourCount} appels en 1h`,
        {
          level: 'error',
        },
      );
      return false;
    }
    return true;
  }

  static isOpen(
    ctx: { openingHours: Record<string, { open: string; close: string } | null> },
    date: string,
    time: string,
  ): boolean {
    const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const d = new Date(`${date}T${time}`);
    const slot = ctx.openingHours[dayMap[d.getDay()]];
    if (!slot) return false;
    const [oh, om] = slot.open.split(':').map(Number);
    const [ch, cm] = slot.close.split(':').map(Number);
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= oh * 60 + om && mins < ch * 60 + cm;
  }
}
