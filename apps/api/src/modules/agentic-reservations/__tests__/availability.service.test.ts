/**
 * Tests for AvailabilityService (coarse search + precise check + policy lookup).
 *
 * - searchAvailableRestaurants : query candidates par (city, partySize, cuisineType)
 *   puis check slot-par-slot, renvoie jusqu'à maxResults.
 * - checkAvailability : si resto introuvable → unknown, sinon délègue à
 *   CapacityAwareAvailabilityService.
 * - getPolicyFor : assemble RestaurantPolicyInput depuis exposureSettings +
 *   restaurant.policyVersion, et construit le snapshot via buildPolicySnapshot.
 *
 * On instancie le service avec un fake PrismaClient qui simule juste les
 * méthodes utilisées, plutôt que de s'appuyer sur le mock partagé (qui
 * ne couvre pas tous les modèles de ce service).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from '../core/availability.service';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service';

const RESTAURANT_ID = 'rest-1';
const PARTY_SIZE = 4;

function makeFakePrisma(
  overrides: Partial<{
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    restaurant: {
      findMany: overrides.findMany ?? vi.fn(),
      findUnique: overrides.findUnique ?? vi.fn(),
      findFirst: overrides.findFirst ?? vi.fn(),
    },
    restaurantExposureSettings: {
      findUnique: vi.fn(),
    },
  } as unknown as ConstructorParameters<typeof AvailabilityService>[0];
}

describe('AvailabilityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchAvailableRestaurants', () => {
    it('retourne un tableau vide si aucun candidat ne correspond', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const service = new AvailabilityService(makeFakePrisma({ findMany }));

      const result = await service.searchAvailableRestaurants({
        city: 'Paris',
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
        maxResults: 10,
      });

      expect(findMany).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('filtre les candidats par ville (formattedAddress contains)', async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 'r-paris',
          name: 'Bistrot Paris',
          slug: 'bistrot-paris',
          lat: 48.85,
          lng: 2.35,
          formattedAddress: '12 Rue de la Paix, 75002 Paris',
        },
        {
          id: 'r-lyon',
          name: 'Bouchon Lyon',
          slug: 'bouchon-lyon',
          lat: 45.76,
          lng: 4.83,
          formattedAddress: '5 Place Bellecour, 69002 Lyon',
        },
      ]);
      const findUnique = vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' });

      // Stub CapacityAware pour ne rendre dispo que r-paris sur le slot 19:00 Paris
      // (= 17:00 UTC en septembre, CEST). Le code fait
      // slotStart.toISOString().slice(11,16) après zonedTimeToUtc, donc
      // on doit matcher la valeur UTC.
      vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockImplementation(
        async ({ restaurantId }) => {
          const available = restaurantId === 'r-paris';
          return {
            restaurantId,
            date: '2026-09-01',
            partySize: PARTY_SIZE,
            slots: [{ time: '17:00', available }],
          };
        },
      );

      const service = new AvailabilityService(makeFakePrisma({ findMany, findUnique }));
      const result = await service.searchAvailableRestaurants({
        city: 'Paris',
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
        maxResults: 10,
      });

      // Seul r-paris (ville OK + slot dispo) doit être retenu
      expect(result).toHaveLength(1);
      expect(result[0].restaurantId).toBe('r-paris');
      expect(result[0].name).toBe('Bistrot Paris');
      expect(result[0].slug).toBe('bistrot-paris');
      expect(result[0].distanceMeters).toBeNull();
    });

    it("respecte maxResults et arrête la boucle dès qu'on a assez de résultats", async () => {
      const candidates = Array.from({ length: 25 }, (_, i) => ({
        id: `r-${i}`,
        name: `R ${i}`,
        slug: `r-${i}`,
        lat: 48.85,
        lng: 2.35,
        formattedAddress: `${i} Rue de Paris`,
      }));
      const findMany = vi.fn().mockResolvedValue(candidates);
      const findUnique = vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' });

      const getAvailabilitySpy = vi
        .spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability')
        .mockImplementation(async ({ restaurantId }) => ({
          restaurantId,
          date: '2026-09-01',
          partySize: PARTY_SIZE,
          slots: [{ time: '17:00', available: true }],
        }));

      const service = new AvailabilityService(makeFakePrisma({ findMany, findUnique }));
      const result = await service.searchAvailableRestaurants({
        city: 'Paris',
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
        maxResults: 3,
      });

      expect(result).toHaveLength(3);
      // Vérifie qu'on a arrêté la boucle après 3 (early break, pas 25 appels)
      expect(getAvailabilitySpy).toHaveBeenCalledTimes(3);
    });

    it('applique le filtre cuisineType sur la query Prisma', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const service = new AvailabilityService(makeFakePrisma({ findMany }));

      await service.searchAvailableRestaurants({
        city: 'Paris',
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
        maxResults: 5,
        cuisineType: ['Italien', 'Japonais'],
      });

      // Le filtre cuisineType est passé via cuisineType.hasSome
      const call = findMany.mock.calls[0][0];
      expect(call.where.cuisineType).toEqual({ hasSome: ['Italien', 'Japonais'] });
    });

    it('omet le filtre cuisineType si non fourni', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const service = new AvailabilityService(makeFakePrisma({ findMany }));

      await service.searchAvailableRestaurants({
        city: 'Paris',
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
        maxResults: 5,
      });

      const call = findMany.mock.calls[0][0];
      expect(call.where.cuisineType).toBeUndefined();
    });
  });

  describe('checkAvailability', () => {
    it("retourne available=false + reason=unknown si le restaurant n'existe pas", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const service = new AvailabilityService(makeFakePrisma({ findUnique }));

      const result = await service.checkAvailability({
        restaurantId: 'inexistant',
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
      });

      expect(result.available).toBe(false);
      expect(result.reason).toBe('unknown');
    });

    it('retourne available=true si le slot est marqué dispo par CapacityAware', async () => {
      const findUnique = vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' });
      // slotStart UTC=19:00 → après zonedTimeToUtc('2026-09-01','19:00','Europe/Paris')
      // le code re-slice en UTC → "17:00" (CEST = UTC+2 en septembre)
      vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockResolvedValue({
        restaurantId: RESTAURANT_ID,
        date: '2026-09-01',
        partySize: PARTY_SIZE,
        slots: [{ time: '17:00', available: true }],
      } as never);

      const service = new AvailabilityService(makeFakePrisma({ findUnique }));
      const result = await service.checkAvailability({
        restaurantId: RESTAURANT_ID,
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
      });

      expect(result.available).toBe(true);
    });

    it("retourne available=false si le slot n'est pas dans la liste", async () => {
      const findUnique = vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' });
      // On met un slot à "21:00" mais la lookup cherche "17:00"
      vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockResolvedValue({
        restaurantId: RESTAURANT_ID,
        date: '2026-09-01',
        partySize: PARTY_SIZE,
        slots: [{ time: '21:00', available: true }],
      } as never);

      const service = new AvailabilityService(makeFakePrisma({ findUnique }));
      const result = await service.checkAvailability({
        restaurantId: RESTAURANT_ID,
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
      });

      expect(result.available).toBe(false);
    });

    it('utilise Europe/Paris par défaut si timezone est null', async () => {
      const findUnique = vi.fn().mockResolvedValue({ timezone: null });
      vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockResolvedValue({
        restaurantId: RESTAURANT_ID,
        date: '2026-09-01',
        partySize: PARTY_SIZE,
        slots: [],
      } as never);

      const service = new AvailabilityService(makeFakePrisma({ findUnique }));
      const result = await service.checkAvailability({
        restaurantId: RESTAURANT_ID,
        partySize: PARTY_SIZE,
        slotStart: new Date('2026-09-01T19:00:00Z'),
        slotEnd: new Date('2026-09-01T20:30:00Z'),
      });

      expect(result.available).toBe(false);
      expect(CapacityAwareAvailabilityService.prototype.getAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: RESTAURANT_ID }),
      );
    });
  });

  describe('getPolicyFor', () => {
    it('construit le policy snapshot depuis exposureSettings + restaurant.policyVersion', async () => {
      const fakePrisma = {
        restaurant: {
          findUnique: vi.fn().mockResolvedValue({ policyVersion: '2026-09-15' }),
        },
        restaurantExposureSettings: {
          findUnique: vi.fn().mockResolvedValue({
            restaurantId: RESTAURANT_ID,
            maxPartySize: 12,
            minLeadTimeMinutes: 30,
            requireManualValidation: false,
            quoteTtlSeconds: 300,
            holdTtlSeconds: 600,
            noShowPolicy: 'warn',
            notificationChannels: ['sms'],
            capacitySpecials: null,
          }),
        },
      } as unknown as ConstructorParameters<typeof AvailabilityService>[0];

      const service = new AvailabilityService(fakePrisma);
      const { policy, settings } = await service.getPolicyFor(RESTAURANT_ID);

      expect(settings?.maxPartySize).toBe(12);
      expect(settings?.policyVersion).toBe('2026-09-15');
      expect(settings?.notificationChannels).toEqual(['sms']);
      expect(policy.maxPartySize).toBe(12);
      expect(policy.policyVersion).toBe('2026-09-15');
    });

    it('utilise les valeurs par défaut si exposureSettings est null', async () => {
      const fakePrisma = {
        restaurant: {
          findUnique: vi.fn().mockResolvedValue({ policyVersion: '2026-06-20' }),
        },
        restaurantExposureSettings: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as ConstructorParameters<typeof AvailabilityService>[0];

      const service = new AvailabilityService(fakePrisma);
      const { policy, settings } = await service.getPolicyFor(RESTAURANT_ID);

      expect(settings?.maxPartySize).toBeNull();
      expect(policy.policyVersion).toBe('2026-06-20');
    });

    it("utilise un policyVersion par défaut si restaurant n'existe pas", async () => {
      const fakePrisma = {
        restaurant: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        restaurantExposureSettings: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as ConstructorParameters<typeof AvailabilityService>[0];

      const service = new AvailabilityService(fakePrisma);
      const { policy } = await service.getPolicyFor('inconnu');

      // Le code fallback sur '2026-06-20'
      expect(policy.policyVersion).toBe('2026-06-20');
    });
  });
});
