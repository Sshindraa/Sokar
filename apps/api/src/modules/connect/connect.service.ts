/**
 * Sokar Connect — Service principal.
 *
 * Responsabilités :
 * - lookup restaurant par slug
 * - vérif gating (connectPublished + connectAgentic)
 * - agrège Restaurant + ExposureSettings + RestaurantImage
 * - sérialise en PublicRestaurantDto
 * - cache Redis 60s
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { logger } from '../../shared/logger/pino';
import {
  type OpeningHoursDay,
  type OpeningHoursSpec,
  type PublicRestaurantDto,
  priceRangeToSymbol,
} from './connect.types';

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY_PREFIX = 'connect:restaurant:';

export class ConnectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  /**
   * Récupère un restaurant publié par slug.
   * Renvoie null si introuvable, non publié, ou slug manquant.
   */
  async getPublishedBySlug(
    slug: string,
    options?: { preview?: boolean },
  ): Promise<PublicRestaurantDto | null> {
    const isPreview = options?.preview === true;
    const cacheKey = `${CACHE_KEY_PREFIX}${slug}`;

    if (!isPreview) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as PublicRestaurantDto;
        }
      } catch (err) {
        // Cache miss / Redis down — fallback DB. On log mais on ne throw pas.
        logger.warn(
          { err: err instanceof Error ? err.message : err, slug },
          'connect cache read failed, falling back to DB',
        );
      }
    }

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      include: {
        exposureSettings: true,
        images: {
          orderBy: [{ isCover: 'desc' }, { position: 'asc' }],
        },
      },
    });

    if (!restaurant) {
      return null;
    }

    const exposure = restaurant.exposureSettings;

    // Gating: la page publique requiert connectPublished + publishedAt + slug
    // (Bypassé en preview mode)
    if (!isPreview) {
      if (!exposure?.connectPublished) {
        return null;
      }
      if (!restaurant.publishedAt) {
        return null;
      }
      // agenticOptIn est utilisé comme "acceptsReservations" sémantique
      // (cf. memory RGPD v1.1 §13.7 — renommage à acceptReservations en P5)
      if (!restaurant.agenticOptIn) {
        return null;
      }
    }

    const dto = this.toPublicDto(restaurant);

    // Cache write (best-effort, uniquement hors preview)
    if (!isPreview) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(dto), 'EX', CACHE_TTL_SECONDS);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, slug },
          'connect cache write failed',
        );
      }
    }

    return dto;
  }

  /**
   * Liste paginée des restaurants publiés (Phase 6 — scalabilité homepage).
   * Pagination réelle en DB (skip/take), pas en mémoire.
   * Retourne le DTO complet pour chaque restaurant (pour la grille homepage).
   */
  async getPublishedRestaurants(
    page: number,
    limit: number,
  ): Promise<{
    restaurants: PublicRestaurantDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where = {
      exposureSettings: { connectPublished: true },
      publishedAt: { not: null },
      slug: { not: null },
      agenticOptIn: true,
    };

    const [total, rows] = await Promise.all([
      this.prisma.restaurant.count({ where }),
      this.prisma.restaurant.findMany({
        where,
        include: {
          exposureSettings: true,
          images: {
            orderBy: [{ isCover: 'desc' }, { position: 'asc' }],
          },
        },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const restaurants = rows.map((r) => this.toPublicDto(r));
    return { restaurants, total, page, limit };
  }

  /**
   * Invalide le cache d'un restaurant (à appeler sur update).
   * Le nom de la méthode matche le pattern des autres services Sokar.
   */
  async invalidateSlugCache(slug: string): Promise<void> {
    try {
      await this.redis.del(`${CACHE_KEY_PREFIX}${slug}`);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, slug },
        'connect cache invalidate failed',
      );
    }
  }

  /**
   * Helper: sérialise le modèle Prisma Restaurant en PublicRestaurantDto.
   * Gère le format openingHours (JSON libre) et l'extraction de la cover.
   */
  private toPublicDto(r: PublicRestaurantSource): PublicRestaurantDto {
    const city = r.city ?? '';
    const country = r.country ?? 'FR';
    const addressLine1 = r.formattedAddress ?? '';

    // OpeningHours est un JSON libre (cf. seed: { tue: { open, close }, ... })
    const openingHours = normalizeOpeningHours(r.openingHours);

    // Cover: première image avec isCover=true, sinon première
    const cover = r.images.find((i) => i.isCover)?.url ?? r.images[0]?.url;
    const gallery = r.images.filter((i) => !i.isCover && i.url !== cover).map((i) => i.url);

    return {
      id: r.id,
      slug: r.slug!,
      name: r.name,
      description: r.description ?? undefined,
      address: {
        line1: addressLine1,
        postalCode: r.postalCode ?? undefined,
        city,
        country,
      },
      phone: r.phoneE164 ?? r.phoneNumber,
      cuisineTypes: r.cuisineType,
      priceRange: priceRangeToSymbol(r.priceRange),
      openingHours,
      reservationUrl: `https://sokar.tech/restaurant/${r.slug}/book`,
      images: {
        cover,
        gallery,
      },
      ambiance: r.ambiance.length > 0 ? r.ambiance : undefined,
      dietary: r.dietary.length > 0 ? r.dietary : undefined,
      noiseLevel: r.noiseLevel ?? undefined,
      acceptsReservations: true,
      publishedAt: r.publishedAt!.toISOString(),
      connectAgentic: r.exposureSettings?.connectAgentic ?? false,
      lat: r.lat ? Number(r.lat) : undefined,
      lng: r.lng ? Number(r.lng) : undefined,
      aggregateRating:
        r.googleRating != null && r.googleReviewCount != null
          ? {
              ratingValue: r.googleRating,
              reviewCount: r.googleReviewCount,
              provider: 'google' as const,
            }
          : undefined,
    };
  }
}

/** Type du résultat Prisma findUnique avec les includes qu'on a demandés */
export type PublicRestaurantSource = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  formattedAddress: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  phoneNumber: string;
  phoneE164: string | null;
  cuisineType: string[];
  priceRange: number | null;
  openingHours: unknown; // JSON
  ambiance: string[];
  dietary: string[];
  noiseLevel: string | null;
  agenticOptIn: boolean;
  publishedAt: Date | null;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  googlePlaceId: string | null;
  exposureSettings: {
    connectPublished: boolean;
    connectAgentic: boolean;
  } | null;
  images: { url: string; isCover: boolean; position: number }[];
};

/**
 * Normalise openingHours JSON en tableau plat trié par jour.
 * Le format seed est { tue: { open, close }, ... }.
 * Format alternatif { dayOfWeek, opens, closes }[] est aussi supporté.
 */
function normalizeOpeningHours(raw: unknown): OpeningHoursSpec {
  if (!raw || typeof raw !== 'object') return [];

  const dayMap: Record<string, OpeningHoursDay['day']> = {
    mon: 'monday',
    tue: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    fri: 'friday',
    sat: 'saturday',
    sun: 'sunday',
    monday: 'monday',
    tuesday: 'tuesday',
    wednesday: 'wednesday',
    thursday: 'thursday',
    friday: 'friday',
    saturday: 'saturday',
    sunday: 'sunday',
  };
  const dayOrder: OpeningHoursDay['day'][] = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];

  // Format A: { mon: { open, close }, tue: { open, close }, ... }
  if (!Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>)
      .map(([key, val]) => {
        const day = dayMap[key.toLowerCase()];
        if (!day) return null;
        if (!val || typeof val !== 'object') return null;
        const v = val as { open?: string; close?: string; opens?: string; closes?: string };
        const open = v.open ?? v.opens;
        const close = v.close ?? v.closes;
        if (!open || !close) return null;
        return { day, open, close };
      })
      .filter((x): x is OpeningHoursDay => x !== null);
    return entries.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
  }

  // Format B: [{ dayOfWeek, opens, closes }, ...] (schema.org style)
  const arr = raw as Array<{ dayOfWeek?: string; opens?: string; closes?: string }>;
  const entries = arr
    .map((entry) => {
      const dow = entry.dayOfWeek?.toLowerCase();
      if (!dow) return null;
      const day = dayMap[dow];
      if (!day || !entry.opens || !entry.closes) return null;
      return { day, open: entry.opens, close: entry.closes };
    })
    .filter((x): x is OpeningHoursDay => x !== null);
  return entries.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
}

/** Hash helper pour le phone (RGPD anonymisation logs) */
export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.toLowerCase()).digest('hex').slice(0, 32);
}
