/**
 * Canal A — Type étendu pour les pages locales (T7).
 * Réutilise PublicRestaurantDto + ajoute les champs villes/cuisines.
 */
import type { PublicRestaurantDto } from './api-client';

export type CityPageData = {
  citySlug: string;
  city: string;
  totalInCity: number;
  restaurants: PublicRestaurantDto[];
  shouldIndex: boolean;
  reason?: 'not_enough_inventory';
};

export type CityCuisinePageData = CityPageData & {
  cuisine: string | null;
  cuisineCount: number;
};
