/**
 * Constantes de conversion temporelle partagées.
 *
 * Utilisées pour remplacer les magic numbers de conversion
 * (ms ↔ sec, min ↔ ms, etc.) dans les services API.
 */

export const MS_TO_SECONDS = 1000;
export const SECONDS_TO_MS = 1000;
export const MINUTES_TO_MS = 60 * 1000;
export const HOURS_TO_MINUTES = 60;
export const HOURS_PER_DAY = 24;
export const DAY_SECONDS = 86400;
export const HOUR_SECONDS = 3600;
export const MS_PER_DAY = 1000 * 60 * 60 * 24;
