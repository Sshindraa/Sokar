/**
 * Tests unitaires pour GiftCardPackService.
 *
 * Le fichier gift-card-pack.test.ts couvre les routes HTTP ; ici on
 * teste directement la logique du service (validation, CRUD, toggle).
 * Prisma est mocké globalement par setup.ts + helpers.ts.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import '../../../test/helpers.js';
import { db } from '../../../shared/db/client.js';
import { GiftCardPackService, GiftCardPackError } from '../gift-card-pack.service.js';

const RESTAURANT_ID = 'rest-pack-1';

function d(value: number) {
  return new Prisma.Decimal(value);
}

const service = new GiftCardPackService(db);

describe('GiftCardPackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it("liste les packs d'un restaurant triés par montant croissant", async () => {
      vi.mocked(db.giftCardPack.findMany).mockResolvedValue([
        { id: 'pack-1', restaurantId: RESTAURANT_ID, amount: d(50), isActive: true } as any,
        { id: 'pack-2', restaurantId: RESTAURANT_ID, amount: d(100), isActive: true } as any,
      ]);

      const packs = await service.list(RESTAURANT_ID);

      expect(packs).toHaveLength(2);
      expect(db.giftCardPack.findMany).toHaveBeenCalledWith({
        where: { restaurantId: RESTAURANT_ID },
        orderBy: { amount: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('crée un pack avec les valeurs par défaut pour minPartySize et maxPartySize', async () => {
      vi.mocked(db.giftCardPack.create).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
        name: 'Menu dégustation',
        amount: d(120),
        minPartySize: 1,
        maxPartySize: 2,
        isActive: true,
      } as any);

      const pack = await service.create({
        restaurantId: RESTAURANT_ID,
        name: 'Menu dégustation',
        amount: 120,
      });

      expect(pack.id).toBe('pack-1');
      expect(db.giftCardPack.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            restaurantId: RESTAURANT_ID,
            name: 'Menu dégustation',
            amount: expect.anything(),
            minPartySize: 1,
            maxPartySize: 2,
          }),
        }),
      );
    });

    it('crée un pack avec description et tailles de convives personnalisées', async () => {
      vi.mocked(db.giftCardPack.create).mockResolvedValue({
        id: 'pack-2',
        restaurantId: RESTAURANT_ID,
        name: 'Soirée groupe',
        description: 'Pour 4 à 6 personnes',
        amount: d(300),
        minPartySize: 4,
        maxPartySize: 6,
        isActive: true,
      } as any);

      await service.create({
        restaurantId: RESTAURANT_ID,
        name: 'Soirée groupe',
        description: 'Pour 4 à 6 personnes',
        amount: 300,
        minPartySize: 4,
        maxPartySize: 6,
      });

      expect(db.giftCardPack.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Pour 4 à 6 personnes',
            minPartySize: 4,
            maxPartySize: 6,
          }),
        }),
      );
    });

    it('retourne erreur si le montant est nul ou négatif', async () => {
      await expect(
        service.create({ restaurantId: RESTAURANT_ID, name: 'Pack', amount: 0 }),
      ).rejects.toThrow(GiftCardPackError);

      await expect(
        service.create({ restaurantId: RESTAURANT_ID, name: 'Pack', amount: -10 }),
      ).rejects.toThrow(GiftCardPackError);
    });

    it('retourne erreur si minPartySize > maxPartySize', async () => {
      await expect(
        service.create({
          restaurantId: RESTAURANT_ID,
          name: 'Pack',
          amount: 100,
          minPartySize: 5,
          maxPartySize: 2,
        }),
      ).rejects.toThrow(GiftCardPackError);
    });
  });

  describe('update', () => {
    it('modifie un pack existant', async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
      } as any);
      vi.mocked(db.giftCardPack.update).mockResolvedValue({
        id: 'pack-1',
        name: 'Menu premium',
        amount: d(150),
      } as any);

      const pack = await service.update('pack-1', RESTAURANT_ID, {
        name: 'Menu premium',
        amount: 150,
      });

      expect(pack.name).toBe('Menu premium');
      expect(db.giftCardPack.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pack-1' },
          data: expect.objectContaining({
            name: 'Menu premium',
            amount: expect.anything(),
          }),
        }),
      );
    });

    it('retourne erreur si le pack est introuvable', async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue(null as any);

      await expect(
        service.update('pack-inexistant', RESTAURANT_ID, { name: 'Nouveau' }),
      ).rejects.toThrow('Pack cadeau introuvable');
    });

    it('retourne erreur si le nouveau montant est négatif', async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
      } as any);

      await expect(service.update('pack-1', RESTAURANT_ID, { amount: -5 })).rejects.toThrow(
        GiftCardPackError,
      );
    });

    it("retourne erreur si minPartySize > maxPartySize lors de l'update", async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
      } as any);

      await expect(
        service.update('pack-1', RESTAURANT_ID, { minPartySize: 10, maxPartySize: 2 }),
      ).rejects.toThrow(GiftCardPackError);
    });

    it("omet les champs non fournis lors de l'update", async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
      } as any);
      vi.mocked(db.giftCardPack.update).mockResolvedValue({
        id: 'pack-1',
        name: 'Nouveau nom',
      } as any);

      await service.update('pack-1', RESTAURANT_ID, { name: 'Nouveau nom' });

      const callData = vi.mocked(db.giftCardPack.update).mock.calls[0]?.[0]?.data as Record<
        string,
        unknown
      >;
      expect(callData.name).toBe('Nouveau nom');
      expect(callData).not.toHaveProperty('amount');
      expect(callData).not.toHaveProperty('description');
    });
  });

  describe('toggle', () => {
    it('active un pack inactif', async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
        isActive: false,
      } as any);
      vi.mocked(db.giftCardPack.update).mockResolvedValue({
        id: 'pack-1',
        isActive: true,
      } as any);

      const pack = await service.toggle('pack-1', RESTAURANT_ID);

      expect(pack.isActive).toBe(true);
      expect(db.giftCardPack.update).toHaveBeenCalledWith({
        where: { id: 'pack-1' },
        data: { isActive: true },
      });
    });

    it('désactive un pack actif', async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
        isActive: true,
      } as any);
      vi.mocked(db.giftCardPack.update).mockResolvedValue({
        id: 'pack-1',
        isActive: false,
      } as any);

      const pack = await service.toggle('pack-1', RESTAURANT_ID);

      expect(pack.isActive).toBe(false);
      expect(db.giftCardPack.update).toHaveBeenCalledWith({
        where: { id: 'pack-1' },
        data: { isActive: false },
      });
    });

    it('retourne erreur si le pack est introuvable', async () => {
      vi.mocked(db.giftCardPack.findFirst).mockResolvedValue(null as any);

      await expect(service.toggle('pack-inexistant', RESTAURANT_ID)).rejects.toThrow(
        'Pack cadeau introuvable',
      );
    });
  });
});
