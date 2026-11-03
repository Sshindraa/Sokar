import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerService } from '../customer.service';
import { db } from '../../../shared/db/client';
import { getCachedContext, redisCache } from '../../../shared/redis/client';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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
    lastReservationName: null,
  };

  describe('buildVipPromptExtra', () => {
    it('client inconnu (pas de nom) → chaîne vide', () => {
      expect(CustomerService.buildVipPromptExtra({ ...baseCustomer, name: null })).toBe('');
    });

    it("compte les vraies visites, jamais l'ancien compteur de réservations téléphone", () => {
      const result = CustomerService.buildVipPromptExtra(
        {
          ...baseCustomer,
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

    it("VIP et occasion, jamais la note libre du gérant, sans accord imposé à l'agent", () => {
      const result = CustomerService.buildVipPromptExtra({
        ...baseCustomer,
        isVip: true,
        specialOccasion: 'anniversaire',
        notes: 'Aime la table 12',
      });
      expect(result).toContain("Client VIP : soigne particulièrement l'échange.");
      expect(result).toContain('Occasion spéciale : anniversaire.');
      expect(result).not.toContain('Aime la table 12');
      expect(result).not.toContain('Note');
      expect(result).not.toContain('attentionné');
    });

    it('sans profil chargé, garde la taille de groupe historique', () => {
      const result = CustomerService.buildVipPromptExtra({ ...baseCustomer, partySizeTypical: 4 });
      expect(result).toContain('4 pers.');
      expect(result).not.toContain('Déjà venu');
    });
  });

  describe('nom connu par la dernière réservation', () => {
    it('reconnaît une fiche sans nom grâce au nom de sa dernière réservation', () => {
      const customer = {
        ...baseCustomer,
        name: null,
        voiceProfile: { ...emptyProfile, pastVisits: 9, lastReservationName: 'Hamza Akkif' },
      };
      expect(CustomerService.buildVipPromptExtra(customer)).toContain('- Nom : Hamza Akkif.');
      expect(CustomerService.buildVipPromptExtra(customer)).toContain('Déjà venu 9 fois');
      expect(CustomerService.returningCustomerFirstName(customer)).toBe('Hamza');
    });

    it('préfère le nom de la fiche à celui de la réservation', () => {
      const customer = {
        ...baseCustomer,
        voiceProfile: { ...emptyProfile, pastVisits: 2, lastReservationName: 'Autre Nom' },
      };
      expect(CustomerService.returningCustomerFirstName(customer)).toBe('Jean');
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

  describe('lookupOrCreate et le cache', () => {
    const cachedWithoutName = {
      id: 'c1',
      name: null,
      isVip: false,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    };
    const row = { ...cachedWithoutName, name: 'Hamza', partySizeTypical: null };

    beforeEach(() => {
      vi.mocked(getCachedContext).mockResolvedValue(cachedWithoutName as never);
      vi.mocked(db.customerIdentity.findUnique).mockResolvedValue(null as never);
      vi.mocked(db.customer.upsert).mockResolvedValue(row as never);
    });

    it('sans nom, sert la fiche gardée en mémoire', async () => {
      const result = await CustomerService.lookupOrCreate('r1', '+33600000000');
      expect(result).toBe(cachedWithoutName);
      expect(db.customer.upsert).not.toHaveBeenCalled();
    });

    it('avec un nom, écrit toujours le nom en base même si la fiche est en mémoire', async () => {
      const result = await CustomerService.lookupOrCreate('r1', '+33600000000', '  Hamza ');
      expect(db.customer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ name: 'Hamza' }) }),
      );
      expect(result.name).toBe('Hamza');
    });

    it('crée une nouvelle fiche en E.164 quand le numéro est saisi à la française', async () => {
      await CustomerService.lookupOrCreate('r1', '06 12 34 56 78', 'Hamza');
      expect(db.customer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { restaurantId_phone: { restaurantId: 'r1', phone: '+33612345678' } },
          create: expect.objectContaining({ phone: '+33612345678' }),
        }),
      );
    });

    it('réutilise une ancienne fiche « 06… » au lieu de créer un doublon', async () => {
      vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'legacy-1' } as never);
      vi.mocked(db.customer.update).mockResolvedValue({ ...row, id: 'legacy-1' } as never);

      const result = await CustomerService.lookupOrCreate('r1', '+33612345678', 'Hamza');

      expect(db.customer.upsert).not.toHaveBeenCalled();
      expect(db.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'legacy-1', restaurantId: 'r1' } }),
      );
      expect(result.id).toBe('legacy-1');
    });

    it("un nom vide n'efface rien et sert la mémoire", async () => {
      const result = await CustomerService.lookupOrCreate('r1', '+33600000000', '   ');
      expect(result).toBe(cachedWithoutName);
      expect(db.customer.upsert).not.toHaveBeenCalled();
    });
  });

  describe('recordCallActivity', () => {
    beforeEach(() => {
      vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'c1' } as never);
    });

    it('retrouve une ancienne fiche enregistrée en « 06… » pour un appel en +33', async () => {
      await CustomerService.recordCallActivity('rest-1', '+33611111111', null);

      expect(db.customer.findFirst).toHaveBeenCalledWith({
        where: {
          restaurantId: 'rest-1',
          phone: { in: ['+33611111111', '0611111111'] },
          archivedAt: null,
          mergedIntoId: null,
        },
        select: { id: true },
      });
    });

    it("n'écrit rien quand aucune fiche active ne correspond", async () => {
      vi.mocked(db.customer.findFirst).mockResolvedValue(null);

      await CustomerService.recordCallActivity('rest-1', '+33611111111', 2);

      expect(db.customer.updateMany).not.toHaveBeenCalled();
    });

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
          where: { id: 'c1', restaurantId: 'rest-1' },
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
