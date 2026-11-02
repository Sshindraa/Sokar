/**
 * Suggestions de services creux : parmi les 7 prochains jours, les services qui garderont probablement
 * des places vides et que rien ne cherche encore à remplir. Lecture seule : aucun client n'est
 * contacté, aucune donnée personnelle n'est renvoyée ni mise en cache.
 */
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import { redisCache } from '../../shared/redis/client';
import { addDays, parisParts } from '../companion/query-data';
import type { TonightService } from '../companion/tonight';
import { isInService } from '../companion/tonight';
import {
  dayBounds,
  forecastEmptyPlaces,
  loadForecastHistory,
  serviceWindow,
  type ForecastSource,
} from './fill-forecast';
import {
  HOLDOUT_RATE,
  estimateFillCost,
  loadServiceFillContext,
  planOpenService,
  serviceAvailability,
  serviceCapacity,
} from './fill-service.service';
import { TIER_PROBABILITY, type FillTier } from './fill-targeting';

const SUGGESTION_HORIZON_DAYS = 7;
const SUGGESTION_LIMIT = 3;
/**
 * shortcut: seuils posés à la main, pas mesurés. Un service creux a au moins 8 places vides et 30 %
 * de sa capacité ; à ajuster avec les retours des restaurateurs.
 */
const MIN_EMPTY_PLACES = 8;
const MIN_EMPTY_RATIO = 0.3;
/** Délai minimal avant le premier créneau : en dessous, un message n'a plus le temps de servir. */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 1800;
const DISMISS_TTL_SECONDS = 604800;

export type FillSuggestion = {
  date: string;
  service: TonightService;
  capacity: number;
  freePlaces: number;
  emptyPlaces: number;
  forecastSource: ForecastSource;
  /** Messages réellement envoyés (hors témoin) sur le canal e-mail ; 0 si rien n'est calculable. */
  sends: number;
  /** Composition de l'audience par palier, en comptes : le texte est produit côté dashboard. */
  tiers: Partial<Record<FillTier, number>>;
  costEstimate: Awaited<ReturnType<typeof estimateFillCost>> | null;
  /** Envois activés, budget restant et au moins un envoi : sinon le service est listé sans bouton. */
  canPrepare: boolean;
};

type Base = Omit<FillSuggestion, 'sends' | 'tiers' | 'costEstimate' | 'canPrepare'>;
type OpenRow = Base & { booked: number };

/**
 * Chiffre chaque service sur le canal e-mail : un seul chargement d'audience pour tous, lancé
 * seulement s'il reste un service. Le score (réservations attendues par envoi) ne sert qu'au tri.
 */
async function enrich(
  restaurantId: string,
  rows: OpenRow[],
  now: Date,
): Promise<Array<FillSuggestion & { score: number }>> {
  const bare = (row: OpenRow) => {
    const { booked: _booked, ...base } = row;
    return { ...base, sends: 0, tiers: {}, costEstimate: null, canPrepare: false, score: 0 };
  };
  if (rows.length === 0) return [];
  let context;
  try {
    context = await loadServiceFillContext({
      restaurantId,
      channel: 'EMAIL',
      through: rows.map((row) => row.date).sort()[rows.length - 1],
      now,
    });
  } catch (err) {
    // Audience au-delà du plafond : les services restent listés, sans chiffre ni bouton.
    if (err instanceof Error && err.message.startsWith('AUDIENCE_TOO_LARGE:')) {
      warn(err, 'fill suggestions audience too large, listing without sends');
      return rows.map(bare);
    }
    throw err;
  }
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });
  const sendsEnabled = process.env.MARKETING_SENDS_ENABLED === 'true';
  return Promise.all(
    rows.map(async (row) => {
      const plan = planOpenService(
        context,
        { date: row.date, service: row.service, now },
        serviceWindow(row.date, row.service),
        { known: true, capacity: row.capacity, booked: row.booked, free: row.freePlaces },
      );
      if (plan.status !== 'PLANNED') return bare(row);
      const sends = plan.members.length - plan.holdoutCount;
      const expected = (Object.entries(plan.tiers) as Array<[FillTier, number]>).reduce(
        (sum, [tier, count]) => sum + TIER_PROBABILITY[tier] * count,
        0,
      );
      return {
        ...bare(row),
        sends,
        tiers: plan.tiers,
        costEstimate:
          sends > 0
            ? await estimateFillCost({
                restaurantName: restaurant?.name ?? null,
                channel: 'EMAIL',
                sends,
                now,
              })
            : null,
        canPrepare: sendsEnabled && !plan.budgetExhausted && sends > 0,
        score: sends > 0 ? (expected * plan.groupSize * (1 - HOLDOUT_RATE)) / sends : 0,
      };
    }),
  );
}

const cacheKey = (restaurantId: string) => `marketing:fill-suggestions:${restaurantId}`;
const dismissKey = (restaurantId: string, date: string, service: TonightService) =>
  `marketing:fill-dismissed:${restaurantId}:${date}:${service}`;

function warn(err: unknown, message: string) {
  logger.warn({ err: err instanceof Error ? err.message : err }, message);
}

export async function listFillSuggestions(args: {
  restaurantId: string;
  now?: Date;
}): Promise<FillSuggestion[]> {
  const now = args.now ?? new Date();
  try {
    const cached = await redisCache.get(cacheKey(args.restaurantId));
    if (cached) return JSON.parse(cached) as FillSuggestion[];
  } catch (err) {
    warn(err, 'fill suggestions cache read failed, computing');
  }

  const today = parisParts(now).dayKey;
  const days = Array.from({ length: SUGGESTION_HORIZON_DAYS }, (_, i) => addDays(today, i));
  const campaigns = await db.marketingCampaign.findMany({
    where: {
      restaurantId: args.restaurantId,
      status: { notIn: ['CANCELLED', 'FAILED'] },
      targetServiceStart: {
        gte: dayBounds(days[0]).start,
        lt: dayBounds(days[days.length - 1]).end,
      },
    },
    select: { targetServiceStart: true },
  });
  const covered = new Set(
    campaigns.flatMap((c) => {
      const at = c.targetServiceStart;
      if (!at) return [];
      return [`${parisParts(at).dayKey}:${isInService(at, 'midi') ? 'midi' : 'soir'}`];
    }),
  );

  const slots = days
    .flatMap((date) => (['midi', 'soir'] as const).map((service) => ({ date, service })))
    .filter(({ date, service }) => !covered.has(`${date}:${service}`));

  // Capacité et disponibilité d'abord : l'historique n'est lu qu'une fois, et seulement s'il sert.
  const open = (
    await Promise.all(
      slots.map(async ({ date, service }) => {
        const window = serviceWindow(date, service);
        const range = { restaurantId: args.restaurantId, ...window };
        const capacity = await serviceCapacity(range);
        if (!capacity.known) return null;
        const availability = await serviceAvailability(range);
        // Premier créneau, pas début de fenêtre : un midi commence à minuit.
        if (!availability.bookable || !availability.firstSlotAt) return null;
        if (availability.firstSlotAt.getTime() - now.getTime() < MIN_LEAD_MS) return null;
        return {
          date,
          service,
          capacity: capacity.capacity,
          freePlaces: capacity.free,
          booked: capacity.booked,
        };
      }),
    )
  ).filter((row) => row !== null);

  let suggestions: OpenRow[] = [];
  if (open.length > 0) {
    const rows = await loadForecastHistory(args.restaurantId, now);
    suggestions = open.flatMap((row) => {
      const { emptyPlaces, forecastSource } = forecastEmptyPlaces({
        rows,
        date: row.date,
        service: row.service,
        freePlaces: row.freePlaces,
        now,
      });
      if (emptyPlaces < MIN_EMPTY_PLACES || emptyPlaces / row.capacity < MIN_EMPTY_RATIO) return [];
      return [{ ...row, emptyPlaces, forecastSource }];
    });
  }

  let dismissed: Array<string | null> = suggestions.map(() => null);
  if (suggestions.length > 0) {
    try {
      dismissed = await redisCache.mget(
        ...suggestions.map((s) => dismissKey(args.restaurantId, s.date, s.service)),
      );
    } catch (err) {
      warn(err, 'fill suggestions dismissed read failed, ignoring');
    }
  }
  const kept = suggestions.filter((_, i) => !dismissed[i]);
  const enriched = await enrich(args.restaurantId, kept, now);
  const result = enriched
    .sort(
      (a, b) =>
        Number(b.canPrepare) - Number(a.canPrepare) ||
        (a.canPrepare ? b.score - a.score : b.emptyPlaces - a.emptyPlaces) ||
        a.date.localeCompare(b.date),
    )
    .slice(0, SUGGESTION_LIMIT)
    // Payload explicite : ni score ni identifiant client ne sortent ni n'entrent dans le cache.
    .map(
      ({
        date,
        service,
        capacity,
        freePlaces,
        emptyPlaces,
        forecastSource,
        sends,
        tiers,
        costEstimate,
        canPrepare,
      }): FillSuggestion => ({
        date,
        service,
        capacity,
        freePlaces,
        emptyPlaces,
        forecastSource,
        sends,
        tiers,
        costEstimate,
        canPrepare,
      }),
    );

  try {
    await redisCache.set(
      cacheKey(args.restaurantId),
      JSON.stringify(result),
      'EX',
      CACHE_TTL_SECONDS,
    );
  } catch (err) {
    warn(err, 'fill suggestions cache write failed');
  }
  return result;
}

/** Lève si Redis échoue : l'ignorance doit être confirmée, sinon la carte reviendrait. */
export async function dismissFillSuggestion(args: {
  restaurantId: string;
  date: string;
  service: TonightService;
}): Promise<void> {
  await redisCache.set(
    dismissKey(args.restaurantId, args.date, args.service),
    '1',
    'EX',
    DISMISS_TTL_SECONDS,
  );
  await invalidateFillSuggestions(args.restaurantId);
}

/** Ne lève jamais : au pire, la liste reste en cache jusqu'à 30 minutes. */
export async function invalidateFillSuggestions(restaurantId: string): Promise<void> {
  try {
    await redisCache.del(cacheKey(restaurantId));
  } catch (err) {
    warn(err, 'fill suggestions cache invalidation failed');
  }
}
