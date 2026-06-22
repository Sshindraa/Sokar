/**
 * Confidence service : calcule la qualité d'un attribut d'un restaurant.
 *
 * Sources possibles :
 * - merchant_declared : le restaurateur l'a déclaré (cap 0.9)
 * - review_inferred : inféré depuis des avis (cap 0.7)
 * - manual_verified : vérifié manuellement par l'équipe Sokar (cap 1.0)
 * - unknown : aucune source (0)
 *
 * Une donnée déclarée n'est pas forcément vraie à 100 %.
 * Une donnée vérifiée manuellement peut monter à 1.0.
 * Si plusieurs sources existent, on prend la plus haute (et on l'enregistre).
 *
 * Stale data : si l'attribut n'a pas été re-vérifié depuis >180 jours, on
 * applique un decay -0.1 (mais on ne descend pas en dessous de 0).
 */

export const MAX_CONFIDENCE = {
  merchant_declared: 0.9,
  review_inferred: 0.7,
  manual_verified: 1.0,
  unknown: 0,
} as const;

export const STALE_DECAY_DAYS = 180;
export const STALE_DECAY_AMOUNT = 0.1;

export type ConfidenceSource = keyof typeof MAX_CONFIDENCE;

export type AttributeConfidence = {
  /** Source primaire (celle qui a le plus de poids) */
  source: ConfidenceSource;
  /** Score brut après application de la cap source */
  raw: number;
  /** Score final après stale decay */
  final: number;
  /** ISO date de dernière vérification (peut être null si inconnu) */
  verifiedAt: string | null;
  /** Si true, decay appliqué */
  stale: boolean;
};

export type AttributeInput = {
  source: ConfidenceSource;
  verifiedAt: string | Date | null;
};

export function computeAttributeConfidence(
  inputs: AttributeInput[],
  now: Date = new Date(),
): AttributeConfidence {
  if (inputs.length === 0) {
    return {
      source: 'unknown',
      raw: 0,
      final: 0,
      verifiedAt: null,
      stale: false,
    };
  }

  // Trier par cap source décroissante, puis par date de vérification
  // (la plus récente gagne).
  const sorted = [...inputs].sort((a, b) => {
    const capA = MAX_CONFIDENCE[a.source];
    const capB = MAX_CONFIDENCE[b.source];
    if (capA !== capB) return capB - capA;
    const dateA = a.verifiedAt ? new Date(a.verifiedAt).getTime() : 0;
    const dateB = b.verifiedAt ? new Date(b.verifiedAt).getTime() : 0;
    return dateB - dateA;
  });

  const winner = sorted[0];
  const cap = MAX_CONFIDENCE[winner.source] as number;
  const raw = cap;
  const verifiedAt = winner.verifiedAt ? new Date(winner.verifiedAt).toISOString() : null;

  let final = raw;
  let stale = false;
  if (verifiedAt) {
    const ageDays = (now.getTime() - new Date(verifiedAt).getTime()) / 86_400_000;
    if (ageDays > STALE_DECAY_DAYS) {
      final = Math.max(0, raw - STALE_DECAY_AMOUNT);
      stale = true;
    }
  }

  return { source: winner.source, raw, final, verifiedAt, stale };
}

/**
 * Calcule la confidence globale d'un restaurant comme la moyenne pondérée
 * des confidences par attribut. Renvoie un score 0..1.
 */
export function computeRestaurantConfidence(
  perAttribute: Record<string, AttributeConfidence>,
): number {
  const values = Object.values(perAttribute);
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, c) => acc + c.final, 0);
  return sum / values.length;
}
