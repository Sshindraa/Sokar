/**
 * Résumé IA de la carte « Ce soir » : trois points au plus, à partir de données que le serveur a
 * déjà calculées (tonight.ts, explain_change, avis en récupération). Le modèle répond par une liste
 * de points ; le serveur ne garde que ceux qui sont courts et dont les chiffres sont dans les données.
 * Le modèle ne reçoit ni nom, ni texte client, et ne calcule rien. Une erreur ou un délai de 8 s :
 * pas de résumé, et seule une trace sans donnée personnelle est écrite.
 */
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { redisCache } from '../../shared/redis/client';
import {
  CompanionUpstreamError,
  completeWithoutTools,
  type CompletionAnswer,
} from './companion.service';
import { type Alongside, type Explanation, explainChange } from './explain-change';
import { anchoredIn } from './grounding';
import { addDays, computeQueryData, type Compared } from './query-data';
import { computeTonight, type TonightCard, type TonightRow } from './tonight';

const BRIEF_TIMEOUT_MS = 8_000;
const BRIEF_CACHE_SECONDS = 1_800;
const RECOVERY_DAYS = 30;
const BRIEF_POINTS = 3;
const POINT_MAX_WORDS = 30;

// Forme imposée au fournisseur : la liste de points. Validée ensuite par Zod, point par point.
const BRIEF_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'brief_points',
    strict: true,
    schema: {
      type: 'object',
      properties: { points: { type: 'array', items: { type: 'string' } } },
      required: ['points'],
      additionalProperties: false,
    },
  },
} as const;
const briefReplySchema = z.object({ points: z.array(z.string()) });

interface ExplanationSummary {
  total: Compared;
  drivers: Array<{ label: string; key: string | number; delta: number; share_pct: number | null }>;
  low_volume: boolean;
  alongside: Pick<Alongside, 'label' | 'value' | 'reference' | 'delta_pct'>[];
}

/** Données transmises au modèle : agrégats et écarts, jamais de nom ni de texte client. */
export interface BriefFacts {
  service: TonightCard['service'];
  date: string;
  covers: number;
  usualCovers: number | null;
  specialRequestsCount: number;
  waitlistCount: number;
  /** Réservations à surveiller, comptées par motif. */
  watch: Record<string, number>;
  /** Clients VIP et réguliers, comptés par motif. */
  attention: Record<string, number>;
  /** La veille contre l'habitude, par explain_change. */
  yesterday: { reservations: ExplanationSummary | null; calls: ExplanationSummary | null };
  /** Avis des 30 derniers jours par état de la tâche de récupération ; null sans la formule Avis. */
  recovery: { days: number; statuses: Array<{ status: string; count: number }> } | null;
}

const countReasons = (rows: TonightRow[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
};

// Une explication sans mesure, ou une réponse indisponible (formule, erreur) : pas de bloc.
function summarize(result: unknown): ExplanationSummary | null {
  if (!result || typeof result !== 'object' || !('measures' in result)) return null;
  const { measures, alongside, labels } = result as Explanation;
  const [measure] = measures;
  if (!measure) return null;
  return {
    total: measure.total,
    drivers: measure.drivers.map(({ dimension, key, delta, share_pct }) => ({
      label: labels[dimension] ?? dimension,
      key,
      delta,
      share_pct,
    })),
    low_volume: measure.low_volume,
    alongside: alongside.map(({ label, value, reference, delta_pct }) => ({
      label,
      value,
      reference,
      delta_pct,
    })),
  };
}

async function recoveryOf(restaurantId: string, day: string): Promise<BriefFacts['recovery']> {
  const result = await computeQueryData(restaurantId, {
    entity: 'feedback',
    metric: 'count',
    date_field: 'submitted',
    group_by: 'recovery',
    from: addDays(day, 1 - RECOVERY_DAYS),
    to: day,
  });
  if (!('groups' in result) || !result.groups) return null;
  const groups = result.groups as Array<{ key: string | number; value: number | null }>;
  return {
    days: RECOVERY_DAYS,
    statuses: groups
      .filter((group) => group.key !== 'none')
      .map((group) => ({ status: String(group.key), count: group.value ?? 0 })),
  };
}

/** Les données du résumé, pour une carte déjà calculée. Rien d'autre n'est lu. */
export async function briefFacts(
  restaurantId: string,
  card: TonightCard,
  options: { recovery: boolean },
): Promise<BriefFacts> {
  const yesterday = addDays(card.date, -1);
  const [reservations, calls, recovery] = await Promise.all([
    explainChange(restaurantId, {
      source: 'reservations',
      measure: 'count',
      date_field: 'service',
      compare: 'usual',
      from: yesterday,
      to: yesterday,
    }),
    explainChange(restaurantId, {
      source: 'calls',
      measure: 'count',
      compare: 'usual',
      from: yesterday,
      to: yesterday,
    }),
    options.recovery ? recoveryOf(restaurantId, card.date) : null,
  ]);
  return {
    service: card.service,
    date: card.date,
    covers: card.covers,
    usualCovers: card.usualCovers,
    specialRequestsCount: card.specialRequestsCount,
    waitlistCount: card.waitlistCount,
    watch: countReasons(card.watch),
    attention: countReasons(card.attention),
    yesterday: { reservations: summarize(reservations), calls: summarize(calls) },
    recovery,
  };
}

export const BRIEF_LANGUAGES = ['fr', 'en', 'es', 'it'] as const;
export type BriefLanguage = (typeof BRIEF_LANGUAGES)[number];

const LANGUAGE_NAMES: Record<BriefLanguage, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  it: 'italien',
};

export function briefSystemPrompt(language: BriefLanguage): string {
  return [
    "Vous êtes l'assistant IA de Sokar. Vous rédigez le résumé de la carte « Ce soir » d'un restaurant, à partir des données fournies.",
    '',
    'Règles :',
    `- Rédigez les points en ${LANGUAGE_NAMES[language]}. Choisissez les trois points les plus utiles avant le service, du plus utile au moins utile, chacun en une phrase courte, un seul fait par point. Adressez-vous au lecteur avec la politesse de cette langue.`,
    "- Dans les points, ce soir d'abord, puis hier.",
    "- Ne citez que les chiffres des données, tels qu'ils y figurent. Ne calculez rien : ni somme, ni écart, ni pourcentage.",
    '- Reliez seulement ce que les données montrent ensemble, en « en même temps ». Jamais une cause extérieure aux données, jamais « à cause de ». Dites ce que vous ne savez pas.',
    "- Vous ne recevez aucun nom de client : n'en écrivez aucun.",
    '- Répondez par un objet JSON de la forme {"points": ["…"]}, sans Markdown.',
  ].join('\n');
}

/** Un tour du modèle sur les données : la réponse brute (JSON), sans validation. Le banc et computeBrief s'en servent. */
export function modelBrief(
  facts: BriefFacts,
  language: BriefLanguage,
  fetcher?: typeof fetch,
): Promise<CompletionAnswer> {
  return completeWithoutTools({
    system: briefSystemPrompt(language),
    user: `Données de la carte (JSON) :\n${JSON.stringify(facts)}`,
    timeoutMs: BRIEF_TIMEOUT_MS,
    responseFormat: BRIEF_RESPONSE_FORMAT,
    fetcher,
  });
}

export interface ComposedBrief {
  /** Les points retenus, une phrase par point ; null sans point valide. */
  text: string | null;
  /** Points retenus, au plus trois. */
  kept: number;
  /** Points écartés : plus de maxWords mots, ou un chiffre absent des données. */
  discarded: number;
  /** Chiffres absents des données, dans les points écartés. */
  unanchored: number[];
  /** Réponse sans JSON valide : rien n'est retenu, et rien n'est gardé en cache. */
  invalid: boolean;
}

/** Valide la réponse du modèle point par point, et garde les trois premiers points valides. */
export function composeBrief(
  facts: BriefFacts,
  raw: string,
  maxWords: number = POINT_MAX_WORDS,
): ComposedBrief {
  let points: string[];
  try {
    const parsed = briefReplySchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return { text: null, kept: 0, discarded: 0, unanchored: [], invalid: true };
    points = parsed.data.points;
  } catch {
    return { text: null, kept: 0, discarded: 0, unanchored: [], invalid: true };
  }

  const kept: string[] = [];
  const unanchored: number[] = [];
  let discarded = 0;
  for (const point of points) {
    const text = point.trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    const missing = anchoredIn(text, [{ result: facts }]).unanchored;
    if (words === 0 || words > maxWords || missing.length > 0) {
      discarded++;
      unanchored.push(...missing);
    } else if (kept.length < BRIEF_POINTS) {
      kept.push(text);
    }
  }
  const sentences = kept.map((point) => (/[.!?]$/.test(point) ? point : `${point}.`));
  return {
    text: sentences.length > 0 ? sentences.join(' ') : null,
    kept: kept.length,
    discarded,
    unanchored,
    invalid: false,
  };
}

const cacheKey = (
  restaurantId: string,
  card: Pick<TonightCard, 'date' | 'service'>,
  language: BriefLanguage,
) => `companion:brief:${restaurantId}:${card.date}:${card.service}:${language}`;

// undefined : pas de résumé en cache. null : résumé refusé (chiffre non ancré), lui aussi gardé.
async function readCache(key: string): Promise<string | null | undefined> {
  try {
    const raw = await redisCache.get(key);
    if (raw === null) return undefined;
    return (JSON.parse(raw) as { brief: string | null }).brief;
  } catch {
    return undefined;
  }
}

async function writeCache(key: string, brief: string | null): Promise<void> {
  try {
    await redisCache.set(key, JSON.stringify({ brief }), 'EX', BRIEF_CACHE_SECONDS);
  } catch {
    // Cache indisponible : le résumé reste servi, il sera recalculé à la prochaine demande.
  }
}

/** Le résumé déjà calculé, lu sans modèle : la carte l'affiche si elle est là, sinon rien. */
export async function cachedBrief(
  restaurantId: string,
  card: Pick<TonightCard, 'date' | 'service'>,
  language: BriefLanguage,
): Promise<string | null> {
  return (await readCache(cacheKey(restaurantId, card, language))) ?? null;
}

/**
 * Le résumé de « Ce soir » pour ce moment : du cache si possible, sinon le modèle. Null si aucun
 * point n'est valide, si la réponse n'est pas du JSON, si le modèle échoue ou dépasse 8 s.
 */
export async function computeBrief(input: {
  restaurantId: string;
  now: Date;
  recovery?: boolean;
  language?: BriefLanguage;
  fetcher?: typeof fetch;
  log: FastifyBaseLogger;
}): Promise<string | null> {
  const language = input.language ?? 'fr';
  const card = await computeTonight(input.restaurantId, input.now);
  const key = cacheKey(input.restaurantId, card, language);
  const cached = await readCache(key);
  if (cached !== undefined) return cached;

  try {
    const facts = await briefFacts(input.restaurantId, card, {
      recovery: input.recovery ?? true,
    });
    const answer = await modelBrief(facts, language, input.fetcher);
    const composed = composeBrief(facts, answer.text);
    const brief = composed.text;
    input.log.info(
      {
        restaurantId: input.restaurantId,
        outcome: composed.invalid ? 'invalid' : brief ? 'ok' : 'no_valid_point',
        points_discarded: composed.discarded,
        unanchored: composed.unanchored,
        model: answer.model,
        latency_ms: answer.latencyMs,
        input_tokens: answer.inputTokens,
        cached_input_tokens: answer.cachedInputTokens,
        output_tokens: answer.outputTokens,
      },
      'companion brief',
    );
    if (!composed.invalid) await writeCache(key, brief);
    return brief;
  } catch (error) {
    // Ni le texte du modèle ni les données ne sont journalisés : seulement la cause.
    const reason =
      error instanceof CompanionUpstreamError
        ? error.message
        : error instanceof Error
          ? error.name
          : 'unknown';
    input.log.warn(
      {
        restaurantId: input.restaurantId,
        outcome: error instanceof CompanionUpstreamError ? 'upstream' : 'error',
        reason,
      },
      'companion brief',
    );
    return null;
  }
}
