import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePlanChoice,
  clearStoredPlanChoice,
  dismissPlanPrompt,
  isPlanPromptDismissed,
  parsePlanChoice,
  readStoredPlanChoice,
} from './pending-plan';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('parsePlanChoice', () => {
  it('lit la formule et la cadence de la page Tarifs', () => {
    expect(parsePlanChoice('?subscribe_plan=pro&billing=monthly')).toEqual({
      plan: 'pro',
      billing: 'monthly',
    });
  });

  it('retient la facturation annuelle par défaut, comme le formulaire d’inscription', () => {
    expect(parsePlanChoice('?subscribe_plan=essential')).toEqual({
      plan: 'essential',
      billing: 'annual',
    });
  });

  it('garde le nombre d’établissements du Multi-restaurant, borné entre 2 et 100', () => {
    expect(parsePlanChoice('?subscribe_plan=multi-site&billing=annual&sites=5')).toEqual({
      plan: 'multi-site',
      billing: 'annual',
      siteCount: 5,
    });
    expect(parsePlanChoice('?subscribe_plan=multi-site&sites=1')?.siteCount).toBe(2);
    expect(parsePlanChoice('?subscribe_plan=multi-site&sites=500')?.siteCount).toBe(2);
    expect(parsePlanChoice('?subscribe_plan=pro&sites=5')).not.toHaveProperty('siteCount');
  });

  it('ignore une formule inconnue ou absente', () => {
    expect(parsePlanChoice('?subscribe_plan=premium')).toBeNull();
    expect(parsePlanChoice('?billing=monthly')).toBeNull();
    expect(parsePlanChoice('')).toBeNull();
  });
});

describe('mémoire du choix', () => {
  it('garde le choix de l’adresse pour le retrouver après la redirection', () => {
    capturePlanChoice('?subscribe_plan=pro&billing=monthly');
    expect(readStoredPlanChoice()).toEqual({ plan: 'pro', billing: 'monthly' });
  });

  it('n’écrase pas un choix par une adresse sans choix', () => {
    capturePlanChoice('?subscribe_plan=pro&billing=monthly');
    capturePlanChoice('?step=phone');
    expect(readStoredPlanChoice()).toEqual({ plan: 'pro', billing: 'monthly' });
  });

  it('oublie le choix une fois le paiement fait', () => {
    capturePlanChoice('?subscribe_plan=pro');
    clearStoredPlanChoice();
    expect(readStoredPlanChoice()).toBeNull();
  });

  it('ignore un contenu stocké qui n’est pas un choix valide', () => {
    window.localStorage.setItem('sokar:onboarding:plan-choice', '{"plan":"gratuit"}');
    expect(readStoredPlanChoice()).toBeNull();
    window.localStorage.setItem('sokar:onboarding:plan-choice', 'pas du json');
    expect(readStoredPlanChoice()).toBeNull();
  });

  it('retient « Plus tard » par restaurant', () => {
    dismissPlanPrompt('restaurant-1');
    expect(isPlanPromptDismissed('restaurant-1')).toBe(true);
    expect(isPlanPromptDismissed('restaurant-2')).toBe(false);
  });

  it('ne casse rien quand le navigateur refuse le stockage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });

    expect(() => capturePlanChoice('?subscribe_plan=pro')).not.toThrow();
    expect(() => dismissPlanPrompt('restaurant-1')).not.toThrow();
    expect(readStoredPlanChoice()).toBeNull();
    expect(isPlanPromptDismissed('restaurant-1')).toBe(false);
  });
});
