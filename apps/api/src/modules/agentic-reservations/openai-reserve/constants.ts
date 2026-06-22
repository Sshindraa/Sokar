/**
 * OpenAI Reserve : business feed + tool restaurant_reservation + widget resource.
 *
 * Spec : https://developers.openai.com/apps-sdk/guides/restaurant-reservation-conversion-spec
 *
 * - Le feed est indexé par OpenAI (fuzzy match, ranking, déduplication).
 *   On ne sert QUE les restos qui ont `openaiReserveEnabled = true` ET
 *   qui ont tous les champs requis (lat, lng, websiteUrl, formattedAddress,
 *   phoneE164). C'est notre garde-fou admin (Phase 2) qui enforce ça.
 * - Le tool `restaurant_reservation` retourne une structure que le widget
 *   charge en iframe (resource URI `ui://widget/restaurant-reservation.html`).
 * - Le widget tourne en standalone dans `apps/widget/`, servi sur
 *   https://api.sokar.app/widget/ (CDN Cloudflare) et référencé par
 *   `_meta.ui.resourceUri` dans le tool response.
 */

export const WIDGET_RESOURCE_URI = 'ui://widget/restaurant-reservation.html';
export const TOOL_NAME = 'restaurant_reservation';

export const WIDGET_PUBLIC_URL =
  process.env.OPENAI_WIDGET_PUBLIC_URL || 'https://widget.sokar.app/restaurant-reservation.html';
