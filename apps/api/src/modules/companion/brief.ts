/**
 * Résumé IA de la carte « Ce soir » : trois phrases au plus, à partir de données que le serveur a
 * déjà calculées (tonight.ts, explain_change, avis en récupération). Le modèle ne reçoit ni nom, ni
 * texte client, et ne calcule rien. Un chiffre absent des données, une erreur ou un délai de 8 s :
 * pas de résumé, et seule une trace sans donnée personnelle est écrite.
 */
import type { FastifyBaseLogger } from 'fastify';
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
  const { measures, alongside } = result as Explanation;
  const [measure] = measures;
  if (!measure) return null;
  return {
    total: measure.total,
    drivers: measure.drivers.map(({ label, key, delta, share_pct }) => ({
      label,
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
    `- Rédigez le résumé en ${LANGUAGE_NAMES[language]}. Trois phrases au plus, vingt mots au plus chacune. Adressez-vous au lecteur avec la politesse de cette langue. Texte simple, sans Markdown.`,
    "- Mettez d'abord ce qui demande une action ou sort de l'habitude : ce soir, puis hier.",
    "- Ne citez que les chiffres des données, tels qu'ils y figurent. Ne calculez rien : ni somme, ni écart, ni pourcentage.",
    '- Reliez seulement ce que les données montrent ensemble, en « en même temps ». Jamais une cause extérieure aux données, jamais « à cause de ». Dites ce que vous ne savez pas.',
    "- Vous ne recevez aucun nom de client : n'en écrivez aucun.",
  ].join('\n');
}

/** Un tour du modèle sur les données : le texte, sans contrôle d'ancrage. Le banc et computeBrief s'en servent. */
export function modelBrief(
  facts: BriefFacts,
  language: BriefLanguage,
  fetcher?: typeof fetch,
): Promise<CompletionAnswer> {
  return completeWithoutTools({
    system: briefSystemPrompt(language),
    user: `Données de la carte (JSON) :\n${JSON.stringify(facts)}`,
    timeoutMs: BRIEF_TIMEOUT_MS,
    fetcher,
  });
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
 * Le résumé de « Ce soir » pour ce moment : du cache si possible, sinon le modèle. Null si un
 * chiffre n'est pas dans les données, si le modèle échoue ou dépasse 8 s.
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
    const unanchored = anchoredIn(answer.text, [{ result: facts }]).unanchored;
    const brief = unanchored.length === 0 ? answer.text : null;
    input.log.info(
      {
        restaurantId: input.restaurantId,
        outcome: brief ? 'ok' : 'ungrounded',
        unanchored,
        model: answer.model,
        latency_ms: answer.latencyMs,
        input_tokens: answer.inputTokens,
        cached_input_tokens: answer.cachedInputTokens,
        output_tokens: answer.outputTokens,
      },
      'companion brief',
    );
    await writeCache(key, brief);
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
