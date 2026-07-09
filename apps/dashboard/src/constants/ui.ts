/**
 * Constantes UI partagées du dashboard — délais, limites, debounce.
 */

/** Délai avant transition automatique entre étapes d'onboarding (ms) */
export const ONBOARDING_STEP_DELAY_MS = 2000;

/** Délai de reset du feedback "copié" du presse-papier (ms) */
export const CLIPBOARD_RESET_DELAY_MS = 2000;

/** Délai de reset de la notification "sauvegardé" (ms) */
export const SAVED_NOTIFICATION_RESET_MS = 3000;

/** Debounce du géocoding Nominatim (ms) */
export const GEOCODING_DEBOUNCE_MS = 1000;

/** Dimension maximale (px) pour le redimensionnement d'images */
export const IMAGE_RESIZE_MAX_DIMENSION = 1000;

/** Longueur maximale du texte de connaissance (systemPromptExtra onboarding) */
export const KNOWLEDGE_TEXT_MAX_LENGTH = 1000;

/** Longueur maximale des instructions personnalisées (settings) */
export const SYSTEM_PROMPT_EXTRA_MAX_LENGTH = 2000;

/** Millisecondes par jour (1000 * 60 * 60 * 24) — conversion temporelle */
export const MS_PER_DAY = 1000 * 60 * 60 * 24;
