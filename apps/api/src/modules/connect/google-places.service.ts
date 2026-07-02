/**
 * Sokar Connect — Google Places Details service.
 *
 * Récupère le rating et le nombre d'avis d'un restaurant depuis Google Places.
 * Respect des CGU Google Places API :
 *   - Attribution obligatoire (gérée dans le JSON-LD : author.name = "Google")
 *   - Pas de republication du texte des avis (on ne stocke que rating + count)
 *   - Cache/sync périodique (pas de call à chaque page view)
 *
 * Coût : Place Details facture par requête. Le worker tourne 1x/jour par resto
 * avec un Place ID, pas à chaque page view.
 *
 * Cf. https://developers.google.com/maps/documentation/places/web-service/details
 */

import { logger } from '../../shared/logger/pino';

const GOOGLE_PLACES_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

export type GooglePlacesRating = {
  rating: number;
  reviewCount: number;
};

/**
 * Récupère le rating et le nombre d'avis depuis Google Places Details API.
 * Retourne null si l'API key n'est pas configurée, si le placeId est vide,
 * ou si l'API renvoie une erreur / pas de rating.
 */
export async function fetchGooglePlacesRating(
  placeId: string,
  apiKey: string | undefined,
): Promise<GooglePlacesRating | null> {
  if (!apiKey) {
    logger.warn('GOOGLE_PLACES_API_KEY not configured, skipping Google Places sync');
    return null;
  }
  if (!placeId) {
    return null;
  }

  const url = `${GOOGLE_PLACES_DETAILS_URL}?place_id=${encodeURIComponent(placeId)}&key=${apiKey}&fields=rating,user_ratings_total`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, placeId }, 'Google Places Details API HTTP error');
      return null;
    }

    const data = (await res.json()) as {
      status: string;
      result?: { rating?: number; user_ratings_total?: number };
      error_message?: string;
    };

    if (data.status !== 'OK' && data.status !== 'OK') {
      logger.warn(
        { status: data.status, error: data.error_message, placeId },
        'Google Places Details API returned non-OK status',
      );
      return null;
    }

    const rating = data.result?.rating;
    const reviewCount = data.result?.user_ratings_total;
    if (rating == null || reviewCount == null) {
      // Le restaurant n'a peut-être pas encore d'avis Google
      return null;
    }

    return { rating, reviewCount };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, placeId },
      'Google Places Details API fetch failed',
    );
    return null;
  }
}
