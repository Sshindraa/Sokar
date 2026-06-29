/**
 * Sokar Connect — Score de complétude du profil restaurant.
 *
 * Calcule un score 0-100% basé sur les champs qui rendent la page publique
 * efficace (SEO, conversion, richesse du profil). Le score alimente :
 *   - La barre de progression dans le dashboard Connect
 *   - Les "actions rapides" (champs manquants prioritaires)
 *   - Le copy contextuel (encouragement vs validation)
 *
 * Le score est pur calcul (pas de DB) — on lui passe le restaurant + exposure.
 */

import type { Restaurant, RestaurantExposureSettings, RestaurantImage } from '@prisma/client';

export type CompletenessItem = {
  /** Clé du champ (slug, description, coverImageUrl, etc.) */
  key: string;
  /** Label user-facing en français */
  label: string;
  /** Poids 0-100 (somme = 100) */
  weight: number;
  /** true si le champ est rempli */
  done: boolean;
  /** Action rapide suggérée si non fait (optionnel) */
  action?: string;
  /** Icône lucide-react name (optionnel, pour le dashboard) */
  icon?: string;
};

export type ConnectScoreResult = {
  /** Score 0-100 arrondi */
  score: number;
  /** Niveau psychologique pour le copy contextuel */
  level: 'starter' | 'progress' | 'almost' | 'premium';
  /** Message contextuel adapté au score */
  message: string;
  /** Tous les items (faits et non faits) */
  items: CompletenessItem[];
  /** Items restants triés par poids décroissant */
  missing: CompletenessItem[];
  /** Nombre d'items complétés */
  completed: number;
  /** Nombre total d'items */
  total: number;
};

type ScoreInput = {
  restaurant: Pick<
    Restaurant,
    | 'name'
    | 'slug'
    | 'description'
    | 'coverImageUrl'
    | 'city'
    | 'formattedAddress'
    | 'lat'
    | 'lng'
    | 'cuisineType'
    | 'priceRange'
    | 'ambiance'
    | 'dietary'
    | 'openingHours'
  >;
  exposure: Pick<RestaurantExposureSettings, 'maxPartySize' | 'capacitySpecials'> | null;
  images: Pick<RestaurantImage, 'id'>[];
};

/**
 * Définition des items de complétude avec leurs poids.
 * Somme des poids = 100.
 */
const SCORE_ITEMS: Array<{
  key: string;
  label: string;
  weight: number;
  icon: string;
  action?: string;
}> = [
  { key: 'name', label: 'Nom du restaurant', weight: 10, icon: 'Type' },
  { key: 'slug', label: 'URL publique (slug)', weight: 5, icon: 'Link' },
  { key: 'description', label: 'Description', weight: 15, icon: 'AlignLeft' },
  { key: 'coverImageUrl', label: 'Photo de couverture', weight: 15, icon: 'Image' },
  { key: 'location', label: 'Adresse & géolocalisation', weight: 15, icon: 'MapPin' },
  { key: 'cuisineType', label: 'Type de cuisine', weight: 10, icon: 'UtensilsCrossed' },
  { key: 'openingHours', label: 'Horaires (≥3 jours)', weight: 10, icon: 'Clock' },
  { key: 'priceRange', label: 'Gamme de prix', weight: 5, icon: 'Euro' },
  { key: 'ambianceDietary', label: 'Ambiance & options', weight: 5, icon: 'Sparkles' },
  { key: 'capacity', label: 'Capacité & règles', weight: 5, icon: 'Users' },
  { key: 'images', label: 'Galerie photos (≥1)', weight: 5, icon: 'Images' },
];

/**
 * Vérifie si un item est complété selon les données du restaurant.
 */
function isItemDone(key: string, input: ScoreInput): boolean {
  const r = input.restaurant;
  switch (key) {
    case 'name':
      return !!r.name && r.name.trim().length >= 2;
    case 'slug':
      return !!r.slug && r.slug.length >= 2;
    case 'description':
      return !!r.description && r.description.trim().length >= 20;
    case 'coverImageUrl':
      return !!r.coverImageUrl;
    case 'location':
      return !!r.city && !!r.formattedAddress && r.lat !== null && r.lng !== null;
    case 'cuisineType':
      return Array.isArray(r.cuisineType) && r.cuisineType.length >= 1;
    case 'openingHours': {
      if (!r.openingHours || typeof r.openingHours !== 'object') return false;
      const hours = r.openingHours as Record<string, unknown>;
      const openDays = Object.values(hours).filter(
        (v) => v !== null && typeof v === 'object' && v !== undefined,
      );
      return openDays.length >= 3;
    }
    case 'priceRange':
      return r.priceRange !== null && r.priceRange !== undefined && r.priceRange >= 1;
    case 'ambianceDietary':
      return (
        (Array.isArray(r.ambiance) && r.ambiance.length >= 1) ||
        (Array.isArray(r.dietary) && r.dietary.length >= 1)
      );
    case 'capacity': {
      const specials = input.exposure?.capacitySpecials as
        | { totalCapacity?: number }
        | null
        | undefined;
      return (
        (specials?.totalCapacity !== undefined && specials.totalCapacity > 0) ||
        (input.exposure?.maxPartySize !== undefined && input.exposure.maxPartySize > 0)
      );
    }
    case 'images':
      return input.images.length >= 1;
    default:
      return false;
  }
}

/**
 * Messages contextuels selon le niveau de complétude.
 */
function getLevelMessage(score: number): { level: ConnectScoreResult['level']; message: string } {
  if (score < 30) {
    return {
      level: 'starter',
      message: 'Commençons par les bases — quelques informations suffisent pour démarrer.',
    };
  }
  if (score < 60) {
    return {
      level: 'progress',
      message: 'Bon début ! Continuez pour rendre votre profil encore plus attractif.',
    };
  }
  if (score < 85) {
    return {
      level: 'almost',
      message: 'Votre profil est presque prêt — plus que quelques détails.',
    };
  }
  return {
    level: 'premium',
    message: 'Profil premium — votre restaurant est prêt à briller en ligne.',
  };
}

/**
 * Calcule le score de complétude Sokar Connect.
 */
export function computeConnectScore(input: ScoreInput): ConnectScoreResult {
  const items: CompletenessItem[] = SCORE_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    weight: item.weight,
    done: isItemDone(item.key, input),
    action: item.action,
    icon: item.icon,
  }));

  const earnedPoints = items.filter((i) => i.done).reduce((sum, i) => sum + i.weight, 0);
  const score = Math.min(100, Math.round(earnedPoints));
  const { level, message } = getLevelMessage(score);
  const missing = items.filter((i) => !i.done).sort((a, b) => b.weight - a.weight);
  const completed = items.filter((i) => i.done).length;

  return {
    score,
    level,
    message,
    items,
    missing,
    completed,
    total: items.length,
  };
}
