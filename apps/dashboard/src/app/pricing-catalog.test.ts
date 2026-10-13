import { describe, expect, it } from 'vitest';
import {
  CATALOG_FEATURES,
  PLAN_ORDER,
  annualMonthlyCents,
  annualTotalCents,
  featuresIncludedIn,
  featuresIntroducedIn,
  formatEuros,
  planIncludes,
  pricingFor,
} from './pricing-catalog';

const NBSP = ' ';

describe('formatEuros : affichage exact en euros', () => {
  it('garde les centimes quand il y en a', () => {
    expect(formatEuros(15920)).toBe('159,20');
    expect(formatEuros(23920)).toBe('239,20');
    expect(formatEuros(7920)).toBe('79,20');
  });

  it('n’affiche pas de centimes sur un montant entier', () => {
    expect(formatEuros(19900)).toBe('199');
    expect(formatEuros(9900)).toBe('99');
  });

  it('groupe les milliers avec une espace insécable', () => {
    expect(formatEuros(191040)).toBe(`1${NBSP}910,40`);
    expect(formatEuros(239040)).toBe(`2${NBSP}390,40`);
  });
});

describe('montants annuels : exacts, à partir du catalogue en euros entiers', () => {
  it('calcule la mensualité annuelle sans arrondi (-20 %)', () => {
    expect(annualMonthlyCents(199)).toBe(15920);
    expect(annualMonthlyCents(299)).toBe(23920);
    expect(annualMonthlyCents(249)).toBe(19920);
    expect(annualMonthlyCents(99)).toBe(7920);
  });

  it('calcule le total annuel exact, aligné sur les montants Stripe vérifiés', () => {
    expect(annualTotalCents(199)).toBe(191040);
    expect(annualTotalCents(299)).toBe(287040);
    expect(annualTotalCents(249)).toBe(239040);
    expect(annualTotalCents(99)).toBe(95040);
  });

  it('donne les mêmes prix que le catalogue partagé pour chaque formule', () => {
    const essential = pricingFor('Essential');
    const pro = pricingFor('Pro');
    const multi = pricingFor('Multi-site');

    expect(essential.monthlyEur).toBe(199);
    expect(pro.monthlyEur).toBe(299);
    expect(multi.monthlyEur).toBe(249);
    expect(multi.sitePriceEur).toBe(99);
    expect(essential.sitePriceEur).toBeNull();
  });
});

describe('catalogue des fonctionnalités', () => {
  it('ne contient que des fonctionnalités disponibles ou prévues', () => {
    for (const feature of CATALOG_FEATURES) {
      expect(['disponible', 'prévu']).toContain(feature.status);
    }
  });

  it('inclut à chaque formule tout ce qui est introduit à son rang ou en dessous', () => {
    const essentialOnly = featuresIntroducedIn('Essential');
    const proOnly = featuresIntroducedIn('Pro');

    expect(featuresIncludedIn('Essential')).toEqual(essentialOnly);
    expect(featuresIncludedIn('Pro')).toEqual([...essentialOnly, ...proOnly]);
    expect(featuresIncludedIn('Multi-site')).toHaveLength(CATALOG_FEATURES.length);
  });

  it("n'inclut pas une fonctionnalité d'une formule supérieure", () => {
    const proFeature = featuresIntroducedIn('Pro')[0];

    expect(planIncludes('Essential', proFeature)).toBe(false);
    expect(planIncludes('Pro', proFeature)).toBe(true);
    expect(planIncludes('Multi-site', proFeature)).toBe(true);
  });

  it('marque comme prévues les intégrations non livrées, jamais comme disponibles', () => {
    const planned = CATALOG_FEATURES.filter((feature) => feature.status === 'prévu');
    const labels = planned.map((feature) => feature.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        'Synchronisation ZenChef, TheFork ou Lightspeed',
        'Réservation depuis ChatGPT et Claude',
      ]),
    );
    expect(
      CATALOG_FEATURES.filter((feature) => feature.status === 'disponible').map((f) => f.label),
    ).not.toEqual(expect.arrayContaining(['Synchronisation ZenChef, TheFork ou Lightspeed']));
  });

  it('ne présente comme disponible ni la comparaison consolidée ni le partage des profils clients', () => {
    const available = CATALOG_FEATURES.filter((feature) => feature.status === 'disponible');

    expect(available.map((feature) => feature.label).join(' ')).not.toMatch(
      /comparaison consolidée|profils clients partagés/i,
    );
  });

  it('garde le suivi des absences dans la formule Essential, comme la page Tarifs', () => {
    expect(featuresIntroducedIn('Essential').map((feature) => feature.label)).toContain(
      'Un fichier client et le suivi des absences',
    );
  });

  it('réserve le copilote de service à Pro et Multi-site, jamais à Essential', () => {
    const copilot = CATALOG_FEATURES.filter((feature) => feature.id.startsWith('copilot-'));

    expect(copilot.length).toBeGreaterThan(0);
    for (const feature of copilot) {
      expect(feature.introducedIn).toBe('Pro');
    }
    expect(
      featuresIncludedIn('Essential').some((feature) => feature.id.startsWith('copilot-')),
    ).toBe(false);
  });

  it('couvre les trois formules dans l’ordre d’affichage', () => {
    expect(PLAN_ORDER).toEqual(['Essential', 'Pro', 'Multi-site']);
  });
});
