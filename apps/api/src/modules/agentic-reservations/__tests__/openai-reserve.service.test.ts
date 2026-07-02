/**
 * Tests unitaires du service OpenAI Reserve.
 * Mock Prisma pour isoler la logique de mapping DB → format OpenAI.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenaiReserveService } from '../openai-reserve/openai-reserve.service';
import { WIDGET_PUBLIC_URL } from '../openai-reserve/constants';

function makeMockPrisma() {
  return {
    restaurant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  } as any;
}

describe('OpenaiReserveService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: OpenaiReserveService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new OpenaiReserveService(prisma);
    vi.clearAllMocks();
  });

  describe('getBusinessFeed', () => {
    it('calcule total_pages et expose la pagination', async () => {
      prisma.restaurant.count.mockResolvedValue(42);
      prisma.restaurant.findMany.mockResolvedValue([]);

      const result = await service.getBusinessFeed({ page: 1, page_size: 20 });
      expect(result.total).toBe(42);
      expect(result.total_pages).toBe(3);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
      expect(result.businesses).toEqual([]);
    });

    it('mappe les colonnes Prisma vers le format OpenAI', async () => {
      prisma.restaurant.count.mockResolvedValue(1);
      prisma.restaurant.findMany.mockResolvedValue([
        {
          id: 'r-1',
          name: 'Le Bistrot',
          slug: 'le-bistrot',
          formattedAddress: '1 rue de Paris, 75001 Paris, France',
          phoneE164: '+33****0000',
          websiteUrl: 'https://bistrot.example',
          lat: { toNumber: () => 48.86 },
          lng: { toNumber: () => 2.35 },
          cuisineType: ['french'],
          priceRange: 2,
          openingHours: { lun: ['12:00-14:30'] },
        },
      ]);

      const result = await service.getBusinessFeed({ page: 1, page_size: 20 });
      expect(result.businesses[0]).toMatchObject({
        id: 'r-1',
        name: 'Le Bistrot',
        location: { latitude: 48.86, longitude: 2.35 },
        phone_number: '+33****0000',
        website_url: 'https://bistrot.example',
        platform_url: 'http://localhost:4002/restaurant/le-bistrot',
        cuisine_type: ['french'],
        price_range: 2,
      });
    });

    it('parse formattedAddress en structuré', async () => {
      prisma.restaurant.count.mockResolvedValue(1);
      prisma.restaurant.findMany.mockResolvedValue([
        {
          id: 'r-1',
          name: 'A',
          slug: 'a',
          formattedAddress: '12 rue Lafayette, 75009 Paris, France',
          phoneE164: '+33****0000',
          websiteUrl: 'https://a.example',
          lat: { toNumber: () => 48.87 },
          lng: { toNumber: () => 2.34 },
          cuisineType: null,
          priceRange: null,
          openingHours: null,
        },
      ]);
      const result = await service.getBusinessFeed({ page: 1, page_size: 20 });
      const addr = result.businesses[0].address as any;
      expect(addr.line1).toBe('12 rue Lafayette');
      expect(addr.country).toBe('FR');
      expect(addr.formatted).toBe('12 rue Lafayette, 75009 Paris, France');
    });

    it('utilise le string brut si le format ne se split pas', async () => {
      prisma.restaurant.count.mockResolvedValue(1);
      prisma.restaurant.findMany.mockResolvedValue([
        {
          id: 'r-1',
          name: 'A',
          slug: 'a',
          formattedAddress: 'un seul segment',
          phoneE164: '+33****0000',
          websiteUrl: 'https://a.example',
          lat: { toNumber: () => 0 },
          lng: { toNumber: () => 0 },
          cuisineType: null,
          priceRange: null,
          openingHours: null,
        },
      ]);
      const result = await service.getBusinessFeed({ page: 1, page_size: 20 });
      expect(result.businesses[0].address).toBe('un seul segment');
    });

    it('checksum = true si aucun changes_token fourni', async () => {
      prisma.restaurant.count.mockResolvedValue(0);
      prisma.restaurant.findMany.mockResolvedValue([]);
      const result = await service.getBusinessFeed({ page: 1, page_size: 20 });
      expect(result.checksum).toBe(true);
      expect(result.changes_token).toBeDefined();
    });

    it('checksum = false si feed vide et changes_token fourni', async () => {
      prisma.restaurant.count.mockResolvedValue(0);
      prisma.restaurant.findMany.mockResolvedValue([]);
      const result = await service.getBusinessFeed({
        page: 1,
        page_size: 20,
        changes_token: 'old',
      });
      expect(result.checksum).toBe(false);
    });
  });

  describe('restaurantReservation', () => {
    it('retourne widget_resource_url + restaurant_name', async () => {
      prisma.restaurant.findUnique.mockResolvedValue({
        id: 'r-1',
        name: 'Le Bistrot',
        formattedAddress: '1 rue de Paris, Paris',
        lat: 48.86,
        lng: 2.35,
        openaiReserveEnabled: true,
        city: 'Paris',
        region: 'IDF',
        postalCode: '75001',
        countryCode: 'FR',
      });

      const result = await service.restaurantReservation({ restaurant_id: 'r-1' });
      expect(result.restaurant_id).toBe('r-1');
      expect(result.restaurant_name).toBe('Le Bistrot');
      expect(result.widget_resource_url).toBe(WIDGET_PUBLIC_URL);
      expect(result.restaurant_address?.locality).toBe('Paris');
      expect(result.restaurant_address?.country).toBe('FR');
    });

    it('jette si restaurant pas openaiReserveEnabled', async () => {
      prisma.restaurant.findUnique.mockResolvedValue({
        id: 'r-1',
        name: 'A',
        formattedAddress: 'x',
        lat: 0,
        lng: 0,
        openaiReserveEnabled: false,
        city: 'x',
        region: 'x',
        postalCode: 'x',
        countryCode: 'FR',
      });
      await expect(service.restaurantReservation({ restaurant_id: 'r-1' })).rejects.toThrow(
        /not OpenAI Reserve enabled/,
      );
    });

    it('jette si restaurant introuvable', async () => {
      prisma.restaurant.findUnique.mockResolvedValue(null);
      await expect(service.restaurantReservation({ restaurant_id: 'r-x' })).rejects.toThrow();
    });
  });
});
