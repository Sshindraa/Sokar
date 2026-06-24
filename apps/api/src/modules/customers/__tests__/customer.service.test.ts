import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerService } from '../customer.service';
import { db } from '../../../shared/db/client';
import { redisCache } from '../../../shared/redis/client';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
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

  it('buildVipPromptExtra — client VIP avec nom et visites', () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1',
      name: 'Jean Dupont',
      visitCount: 3,
      isVip: true,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    expect(result).toContain('Jean Dupont');
    expect(result).toContain('VIP');
    expect(result).toContain('4e visite');
  });

  it('buildVipPromptExtra — client inconnu → chaîne vide', () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1',
      name: null,
      visitCount: 0,
      isVip: false,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    expect(result).toBe('');
  });

  it('buildVipPromptExtra — occasion spéciale incluse', () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1',
      name: 'Marie',
      visitCount: 1,
      isVip: false,
      specialOccasion: 'anniversaire',
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    expect(result).toContain('anniversaire');
  });

  it("buildVipPromptExtra — partySizeTypical affiché quand on l'a", () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1',
      name: 'Jean',
      visitCount: 5,
      isVip: false,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: 4,
    });
    expect(result).toContain('4 pers.');
  });

  describe('buildReturningGreeting', () => {
    it('VIP nommé → "content de vous revoir M. <prénom>"', () => {
      const result = CustomerService.buildReturningGreeting({
        id: '1',
        name: 'Jean Dupont',
        visitCount: 10,
        isVip: true,
        specialOccasion: null,
        notes: null,
        lastCallAt: null,
        partySizeTypical: null,
      });
      expect(result).toContain('content de vous revoir');
      expect(result).toContain('M. Jean');
    });

    it('retour non-VIP avec visites → "ravi de vous revoir <prénom>"', () => {
      const result = CustomerService.buildReturningGreeting({
        id: '1',
        name: 'Marie Curie',
        visitCount: 2,
        isVip: false,
        specialOccasion: null,
        notes: null,
        lastCallAt: null,
        partySizeTypical: null,
      });
      expect(result).toContain('ravi de vous revoir');
      expect(result).toContain('Marie');
    });

    it('nouveau client (visitCount=0) → chaîne vide', () => {
      const result = CustomerService.buildReturningGreeting({
        id: '1',
        name: 'Paul',
        visitCount: 0,
        isVip: false,
        specialOccasion: null,
        notes: null,
        lastCallAt: null,
        partySizeTypical: null,
      });
      expect(result).toBe('');
    });

    it('client inconnu (pas de nom) → chaîne vide', () => {
      const result = CustomerService.buildReturningGreeting({
        id: '1',
        name: null,
        visitCount: 5,
        isVip: true,
        specialOccasion: null,
        notes: null,
        lastCallAt: null,
        partySizeTypical: null,
      });
      expect(result).toBe('');
    });
  });

  describe('recordCallActivity', () => {
    it('met à jour lastCallAt sur tout appel et invalide le cache', async () => {
      vi.mocked(db.customer.findUnique).mockResolvedValue(null as any);
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as any);

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
      vi.mocked(db.customer.findUnique).mockResolvedValue(null as any);
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as any);

      await CustomerService.recordCallActivity('rest-1', '+33611111111', 3);

      const dataArg = vi.mocked(db.customer.updateMany).mock.calls[0][0].data as any;
      expect(dataArg.partySizeTypical).toBe(3);
    });

    it('appels successifs: moyenne glissante 70/30', async () => {
      // Mimic Prisma's Decimal-like return — our code does `Number(existing.partySizeTypical)`.
      vi.mocked(db.customer.findUnique).mockResolvedValue({
        partySizeTypical: 4,
      } as any);
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as any);

      await CustomerService.recordCallActivity('rest-1', '+336****1111', 2);

      const dataArg = vi.mocked(db.customer.updateMany).mock.calls[0][0].data as any;
      // 0.7 * 2 + 0.3 * 4 = 1.4 + 1.2 = 2.6 → 3 (rounded)
      expect(dataArg.partySizeTypical).toBe(3);
    });

    it('ne touche pas partySizeTypical si partySize null/0', async () => {
      vi.mocked(db.customer.updateMany).mockResolvedValue({ count: 1 } as any);

      await CustomerService.recordCallActivity('rest-1', '+33611111111', 0);

      const dataArg = vi.mocked(db.customer.updateMany).mock.calls[0][0].data as any;
      expect(dataArg.partySizeTypical).toBeUndefined();
      expect(dataArg.lastCallAt).toBeInstanceOf(Date);
    });
  });
});
