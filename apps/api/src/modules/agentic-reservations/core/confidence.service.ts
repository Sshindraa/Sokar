/**
 * Confidence service : calcule la qualité d'un attribut d'un restaurant.
 *
 * Les implémentations pures sont dans `@suppernote/shared` pour être réutilisées
 * par le builder JSON-LD (partagé entre API et Connect).
 */

export {
  MAX_CONFIDENCE,
  STALE_DECAY_DAYS,
  STALE_DECAY_AMOUNT,
  type ConfidenceSource,
  type AttributeConfidence,
  type AttributeInput,
  computeAttributeConfidence,
  computeRestaurantConfidence,
} from '@suppernote/shared';
