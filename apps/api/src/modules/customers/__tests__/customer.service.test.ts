import { describe, it, expect } from 'vitest';
import { CustomerService } from '../customer.service';

describe('CustomerService', () => {
  it('buildVipPromptExtra — client VIP avec nom et visites', () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1', name: 'Jean Dupont', visitCount: 3,
      isVip: true, specialOccasion: null, notes: null,
    });
    expect(result).toContain('Jean Dupont');
    expect(result).toContain('VIP');
    expect(result).toContain('4e visite');
  });

  it('buildVipPromptExtra — client inconnu → chaîne vide', () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1', name: null, visitCount: 0,
      isVip: false, specialOccasion: null, notes: null,
    });
    expect(result).toBe('');
  });

  it('buildVipPromptExtra — occasion spéciale incluse', () => {
    const result = CustomerService.buildVipPromptExtra({
      id: '1', name: 'Marie', visitCount: 1,
      isVip: false, specialOccasion: 'anniversaire', notes: null,
    });
    expect(result).toContain('anniversaire');
  });
});
