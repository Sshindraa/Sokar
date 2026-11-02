export type FillTier = 'CRENEAU' | 'REGULIER' | 'CONNU' | 'SANS_VISITE';
export type VisitStats = { slotVisits: number; visits: number; lastSlotAt: number; lastAt: number };

export const FILL_MODEL_VERSION = 'v1';

// shortcut: probabilités posées à la main, utilisées seulement pour dimensionner l'audience ; à
// remplacer quand la mesure par palier existe. Il s'agit de la probabilité de réserver après le
// message, pas de l'effet propre du message.
export const TIER_PROBABILITY: Record<FillTier, number> = {
  CRENEAU: 0.3,
  REGULIER: 0.15,
  CONNU: 0.08,
  SANS_VISITE: 0.03,
};

// Sous ce seuil, un client n'est jamais contacté dans ce lot.
export const MIN_PROBABILITY = 0.05;

const TIER_ORDER: FillTier[] = ['CRENEAU', 'REGULIER', 'CONNU', 'SANS_VISITE'];
const DAY_MS = 24 * 3600_000;

export function tierOf(stats: VisitStats, now: Date): FillTier {
  if (stats.slotVisits >= 2 && now.getTime() - stats.lastSlotAt < 120 * DAY_MS) return 'CRENEAU';
  if (stats.visits >= 3 && now.getTime() - stats.lastAt < 180 * DAY_MS) return 'REGULIER';
  return stats.visits >= 1 ? 'CONNU' : 'SANS_VISITE';
}

/**
 * Audience triée par palier, puis visites sur le créneau, puis récence. S'arrête quand les
 * réservations attendues (p × taille du groupe × part contactée) atteignent les places vides, et
 * plafonne les envois (le témoin fait partie de l'audience sans recevoir de message).
 */
export function selectFillAudience<T extends { tier: FillTier; stats: VisitStats }>(args: {
  candidates: T[];
  emptyPlaces: number;
  groupSize: number;
  holdoutRate: number;
  maxSends: number;
}): T[] {
  const { candidates, emptyPlaces, groupSize, holdoutRate, maxSends } = args;
  if (emptyPlaces <= 0 || maxSends <= 0) return [];
  const sorted = candidates
    .filter((c) => TIER_PROBABILITY[c.tier] >= MIN_PROBABILITY)
    .sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        b.stats.slotVisits - a.stats.slotVisits ||
        b.stats.lastAt - a.stats.lastAt,
    );
  const audience: T[] = [];
  let expected = 0;
  for (const c of sorted) {
    if (expected >= emptyPlaces) break;
    const size = audience.length + 1;
    // Les envois ne baissent jamais quand la taille grandit : le premier dépassement arrête la liste.
    if (size - Math.round(size * holdoutRate) > maxSends) break;
    audience.push(c);
    expected += TIER_PROBABILITY[c.tier] * groupSize * (1 - holdoutRate);
  }
  return audience;
}

export function countByTier(tiers: FillTier[]): Partial<Record<FillTier, number>> {
  const counts: Partial<Record<FillTier, number>> = {};
  for (const tier of tiers) counts[tier] = (counts[tier] ?? 0) + 1;
  return counts;
}
