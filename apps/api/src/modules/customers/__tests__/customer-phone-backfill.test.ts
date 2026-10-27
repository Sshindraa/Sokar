import { describe, expect, it } from 'vitest';
import { planPhoneBackfill } from '../customer-phone-backfill';

describe('planPhoneBackfill', () => {
  it('passe un numéro national en E.164 et ignore ce qui est déjà canonique', () => {
    const plan = planPhoneBackfill([
      { id: 'a', phone: '0698765432', active: true },
      { id: 'b', phone: '+33611111111', active: true },
    ]);
    expect(plan.updates).toEqual([{ id: 'a', from: '0698765432', to: '+33698765432' }]);
    expect(plan.collisions).toEqual([]);
  });

  it('ne touche pas un numéro dont la cible est déjà prise, même par un profil archivé', () => {
    const plan = planPhoneBackfill([
      { id: 'a', phone: '0698765432', active: true },
      { id: 'b', phone: '+33698765432', active: false },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.collisions).toEqual([
      { id: 'a', from: '0698765432', to: '+33698765432', otherId: 'b' },
    ]);
  });

  it('ne réécrit qu’un seul de deux profils qui visent le même numéro', () => {
    const plan = planPhoneBackfill([
      { id: 'a', phone: '06 98 76 54 32', active: true },
      { id: 'b', phone: '0698765432', active: true },
    ]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.collisions).toHaveLength(1);
  });

  it('compte sans modifier un numéro non normalisable (profil effacé RGPD)', () => {
    const plan = planPhoneBackfill([{ id: 'a', phone: 'erased:abc', active: true }]);
    expect(plan).toEqual({ updates: [], collisions: [], unparseable: 1 });
  });
});
