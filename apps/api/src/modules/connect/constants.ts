/**
 * Constantes de rate limits et pagination pour Sokar Connect.
 *
 * Centralise les limites par endpoint public pour éviter
 * les magic numbers éparpillés dans connect.routes.ts.
 */

export const RATE_LIMIT_PREVIEW_MAX = 60;
export const RATE_LIMIT_SITEMAP_MAX = 10;
export const RATE_LIMIT_RESTAURANTS_MAX = 30;
export const RATE_LIMIT_CITIES_MAX = 30;
export const RATE_LIMIT_CITY_DETAIL_MAX = 30;
export const RATE_LIMIT_ANALYTICS_MAX = 60;
export const RATE_LIMIT_AVAILABILITY_MAX = 30;
export const RATE_LIMIT_HOLD_MAX = 11;
export const RATE_LIMIT_CONFIRM_MAX = 10;
export const RATE_LIMIT_WAITING_LIST_JOIN_MAX = 10;
export const RATE_LIMIT_WAITING_LIST_CANCEL_MAX = 20;
export const PAGINATION_DEFAULT_LIMIT = 12;
export const PAGINATION_MAX_LIMIT = 50;
