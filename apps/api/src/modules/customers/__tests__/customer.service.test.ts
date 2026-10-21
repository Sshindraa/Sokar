import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerService } from '../customer.service';
import { db } from '../../../shared/db/client';
import { redisCache } from '../../../shared/redis/client';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    customerIdentity: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    customerTimelineEvent: { findUnique: vi.fn(), create: vi.fn() },
    customerMetricSnapshot: { upsert: vi.fn() },
    reservation: { findMany: vi.fn() },
  },
}));

vi.mock('../../../shared/redis/client', () => ({
  redisCache: {
    del: vi.fn().mockResolvedValue(1),
  },
  getCachedContext: vi.fn().mockResolvedValue(null),
  setCachedContext: vi.fn().mockResolvedValue(undefined),
}));

describe('CustomerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseCustomer = {
    id: '1',
    name: 'Jean Dupont',
    visitCount: 0,
    isVip: false,
    specialOccasion: null,
    notes: null,
    lastCallAt: null,
    partySizeTypical: null,
  };
  const emptyProfile = {
    pastVisits: 0,
    lastVisitAt: null,
    upcomingReservation: null,
    typicalPartySize: null,
    preferences: [],
    tags: [],
  };

  describe('buildVipPromptExtra', () => {
    it('client inconnu (pas de nom) → chaîne vide', () => {
      expect(CustomerService.buildVipPromptExtra({ ...baseCustomer, name: null })).toBe('');
    });

    it("compte les vraies visites, jamais l'ancien compteur de réservations téléphone", () => {
      const result = CustomerService.buildVipPromptExtra(
        {
          ...baseCustomer,
          visitCount: 9,
          voiceProfile: {
            ...emptyProfile,
            pastVisits: 3,
            lastVisitAt: '2026-09-12T18:30:00.000Z',
            typicalPartySize: 4,
          },
        },
        { timezone: 'Europe/Paris' },
      );
      expect(result).toContain('Déjà venu 3 fois ; dernière visite le 12 septembre 2026.');
      expect(result).toContain('Taille de groupe habituelle : 4 pers.');
      expect(result).not.toContain('9');
      expect(result).not.toContain('visite.');
    });

    it('dit « aucune visite » quand le numéro a seulement réservé', () => {
      const result = CustomerService.buildVipPromptExtra({
        ...baseCustomer,
        visitCount: 2,
        voiceProfile: emptyProfile,
      });
      expect(result).toContain('Aucune visite passée connue.');
    });

    it('transmet réservation à venir, préférences confirmées et étiquettes', () => {
      const result = CustomerService.buildVipPromptExtra(
        {
          ...baseCustomer,
          voiceProfile: {
            ...emptyProfile,
            upcomingReservation: { startsAt: '2026-10-24T18:00:00.000Z', partySize: 4 },
            preferences: [
              { key: 'preferred_section', value: 'terrasse' },
              { key: 'dietary_restrictions', value: 'sans gluten' },
            ],
            tags: ['Habitué'],
          },
        },
        { timezone: 'Europe/Paris' },
      );
      expect(result).toContain('Réservation à venir : samedi 24 octobre à 20:00, 4 pers.');
      expect(result).toContain('zone préférée : terrasse ; régime alimentaire : sans gluten');
      expect(result).toContain("Étiquettes de l'équipe : Habitué.");
      expect(result).toContain("ne s'étend pas aux autres convives");
    });

    it("VIP, occasion et note du gérant, sans accord imposé à l'agent", () => {
      const result = CustomerService.buildVipPromptExtra({
        ...baseCustomer,
        isVip: true,
        specialOccasion: 'anniversaire',
        notes: 'Aime la table 12',
      });
      expect(result).toContain("Client VIP : soigne particulièrement l'échange.");
      expect(result).toContain('Occasion spéciale : anniversaire.');
      expect(result).toContain('Note du gérant : Aime la table 12');
      expect(result).not.toContain('attentionné');
    });

    it('sans profil chargé, garde la taille de groupe historique', () => {
      const result = CustomerService.buildVipPromptExtra({ ...baseCustomer, partySizeTypical: 4 });
      expect(result).toContain('4 pers.');
      expect(result).not.toContain('Déjà venu');
    });
  });

  describe('returningCustomerFirstName', () => {
    it('client déjà venu → prénom seul', () => {
      expect(
        CustomerService.returningCustomerFirstName({
          ...baseCustomer,
          voiceProfile: { ...emptyProfile, pastVisits: 2 },
        }),
      ).toBe('Jean');
    });

    it("VIP marqué par l'équipe sans visite enregistrée → prénom", () => {
      expect(CustomerService.returningCustomerFirstName({ ...baseCustomer, isVip: true })).toBe(
        'Jean',
      );
    });

    it('réservations téléphone sans visite passée → rien', () => {
      expect(
        CustomerService.returningCustomerFirstName({
          ...baseCustomer,
          visitCount: 5,
          voiceProfile: emptyProfile,
        }),
      ).toBe('');
    });

    it('client sans nom → rien', () => {
      expect(
        CustomerService.returningCustomerFirstName({
          ...baseCustomer,
          name: null,
          isVip: true,
          voiceProfile: { ...emptyProfile, pastVisits: 5 },
        }),
      ).toBe('');
    });
  });

  describe('recordCallActivity', () => {
    it('met à jour lastCallAt sur tout appel et invalide le cache', async () => {
      vi.mocked(db.customer.findUnique).mockResolvedValue(
        null as unknown as Awaited<ReturnType<typeof db.customer.findUnique>>,
      );
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as unknown as Awaited<
        ReturnType<typeof db.customer.updateMany>
      >);

      await CustomerService.recordCallActivity('rest-1', '+33611111111', null);

      expect(db.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { restaurantId: 'rest-1', phone: '+33611111111' },
          data: expect.objectContaining({ lastCallAt: expect.any(Date) }),
        }),
      );
      expect(redisCache.del).toHaveBeenCalledWith('customer:rest-1:+33611111111');
    });

    it('premier appel avec partySize: stocke la valeur', async () => {
      vi.mocked(db.customer.findUnique).mockResolvedValue(
        null as unknown as Awaited<ReturnType<typeof db.customer.findUnique>>,
      );
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as unknown as Awaited<
        ReturnType<typeof db.customer.updateMany>
      >);

      await CustomerService.recordCallActivity('rest-1', '+33611111111', 3);

      const dataArg = vi.mocked(db.customer.updateMany).mock.calls[0][0].data as unknown as Record<
        string,
        unknown
      >;
      expect(dataArg.partySizeTypical).toBe(3);
    });

    it('appels successifs: moyenne glissante 70/30', async () => {
      // Mimic Prisma's Decimal-like return — our code does `Number(existing.partySizeTypical)`.
      vi.mocked(db.customer.findUnique).mockResolvedValue({
        partySizeTypical: 4,
      } as unknown as Awaited<ReturnType<typeof db.customer.findUnique>>);
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as unknown as Awaited<
        ReturnType<typeof db.customer.updateMany>
      >);

      await CustomerService.recordCallActivity('rest-1', '+336****1111', 2);

      const dataArg = vi.mocked(db.customer.updateMany).mock.calls[0][0].data as unknown as Record<
        string,
        unknown
      >;
      // 0.7 * 2 + 0.3 * 4 = 1.4 + 1.2 = 2.6 → 3 (rounded)
      expect(dataArg.partySizeTypical).toBe(3);
    });

    it('ne touche pas partySizeTypical si partySize null/0', async () => {
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as unknown as Awaited<
        ReturnType<typeof db.customer.updateMany>
      >);

      await CustomerService.recordCallActivity('rest-1', '+33611111111', 0);

      const dataArg = vi.mocked(db.customer.updateMany).mock.calls[0][0].data as unknown as Record<
        string,
        unknown
      >;
      expect(dataArg.partySizeTypical).toBeUndefined();
      expect(dataArg.lastCallAt).toBeInstanceOf(Date);
    });
  });
});
