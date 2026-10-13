/**
 * Fiche restaurant renvoyée au client. Le jeton Google Agenda (`googleRefreshToken`) donne un accès
 * durable à l'agenda du restaurant : il ne quitte jamais le serveur. Le client reçoit seulement
 * `googleCalendarConnected` pour savoir si l'agenda est relié.
 */
export function toRestaurantResponse<T extends { googleRefreshToken?: string | null }>(
  restaurant: T,
): Omit<T, 'googleRefreshToken'> & { googleCalendarConnected: boolean } {
  const { googleRefreshToken, ...rest } = restaurant;
  return { ...rest, googleCalendarConnected: Boolean(googleRefreshToken) };
}
