import { normalizeOpeningHours } from '@sokar/shared';

export const DEEPGRAM_KEYTERM_TOKEN_BUDGET = 200;
export const DEEPGRAM_KEYTERM_MAX_TERMS = 50;

export interface DeepgramKeytermSources {
  restaurantName?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  neighborhoods?: readonly string[];
  city?: string | null;
  cuisineTypes?: readonly string[];
  menuTerms?: readonly string[];
  /** Horaires bruts du restaurant : s'ils existent, les jours deviennent des mots-clés. */
  openingHours?: unknown;
}

/**
 * Jours qu'un appelant nomme pour demander si le restaurant est ouvert. Le flux Deepgram a
 * rendu « demain vous êtes ouvert » par « donald » (appel a1ba681f) et « demeure » (45c4cb71),
 * alors que le même audio relu en fichier donnait « demain ». Un jour fermé compte aussi :
 * l'agent doit l'entendre pour répondre qu'il est fermé.
 */
export const DEEPGRAM_DAY_KEYTERMS = [
  'demain',
  'après-demain',
  'aujourd’hui',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;

/** Les jours ne servent qu'à un restaurant qui a des horaires à annoncer. */
export function buildDeepgramDayKeyterms(openingHours: unknown): string[] {
  return normalizeOpeningHours(openingHours).length > 0 ? [...DEEPGRAM_DAY_KEYTERMS] : [];
}

/**
 * Tailles de groupe dites seules au téléphone : « trois » isolé revenait vide de
 * Deepgram (appel c5d6b07d). « un » est exclu, trop fréquent comme article.
 */
export const DEEPGRAM_PARTY_SIZE_KEYTERMS = [
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
] as const;

function estimatedTokenCount(value: string): number {
  const wordCount = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return Math.max(wordCount, Math.ceil(value.length / 3));
}

function containsContactData(value: string): boolean {
  const digits = value.match(/\d/gu)?.length ?? 0;
  return /@|https?:\/\//iu.test(value) || digits >= 8;
}

/** Build a conservative, business-only keyterm list under Deepgram's separate token budget. */
export function buildDeepgramKeyterms(
  sources: DeepgramKeytermSources,
  tokenBudget = DEEPGRAM_KEYTERM_TOKEN_BUDGET,
): string[] {
  if (!Number.isInteger(tokenBudget) || tokenBudget < 0) return [];

  const candidates = [
    sources.restaurantName,
    ...(sources.menuTerms ?? []),
    sources.neighborhood,
    ...(sources.neighborhoods ?? []),
    sources.address,
    sources.city,
    ...(sources.cuisineTypes ?? []),
  ];
  const keyterms: string[] = [];
  const seen = new Set<string>();
  let tokens = 0;

  for (const candidate of candidates) {
    const term = candidate?.trim().replace(/\s+/gu, ' ');
    if (!term || term.length > 120 || containsContactData(term)) continue;

    const dedupeKey = term.toLocaleLowerCase('fr-FR');
    if (seen.has(dedupeKey)) continue;
    const termTokens = estimatedTokenCount(term);
    if (termTokens === 0 || termTokens > tokenBudget - tokens) continue;

    seen.add(dedupeKey);
    keyterms.push(term);
    tokens += termTokens;
    if (keyterms.length >= DEEPGRAM_KEYTERM_MAX_TERMS) break;
  }

  return keyterms;
}

/**
 * Mots-clés d'un appel : les tailles de groupe et les jours d'abord (budget réservé),
 * puis les termes propres au restaurant dans le budget restant.
 */
export function buildDeepgramCallKeyterms(
  sources: DeepgramKeytermSources,
  tokenBudget = DEEPGRAM_KEYTERM_TOKEN_BUDGET,
): string[] {
  const reserved = [
    ...DEEPGRAM_PARTY_SIZE_KEYTERMS,
    ...buildDeepgramDayKeyterms(sources.openingHours),
  ];
  const reservedTokens = reserved.reduce((total, term) => total + estimatedTokenCount(term), 0);
  if (reservedTokens > tokenBudget) return buildDeepgramKeyterms(sources, tokenBudget);
  const reservedKeys = new Set(reserved.map((term) => term.toLocaleLowerCase('fr-FR')));
  const business = buildDeepgramKeyterms(sources, tokenBudget - reservedTokens).filter(
    (term) => !reservedKeys.has(term.toLocaleLowerCase('fr-FR')),
  );
  return [...reserved, ...business].slice(0, DEEPGRAM_KEYTERM_MAX_TERMS);
}
