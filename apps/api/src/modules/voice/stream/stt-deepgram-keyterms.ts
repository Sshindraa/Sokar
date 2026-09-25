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
}

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
