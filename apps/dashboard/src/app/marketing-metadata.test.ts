import { describe, expect, it } from 'vitest';
import { PLAN_PRICES_EUR } from '@sokar/shared';
import { DEMO_METADATA, HOME_METADATA, PRICING_METADATA } from './marketing-metadata';

const GENERIC_DESCRIPTION = 'Assistant vocal intelligent pour votre restaurant';

describe('métadonnées de la vitrine', () => {
  it.each([
    ['accueil', HOME_METADATA, '/'],
    ['tarifs', PRICING_METADATA, '/pricing'],
    ['démonstration', DEMO_METADATA, '/demo'],
  ])(
    'définit un titre, une description et une canonical propres à %s',
    (_label, metadata, path) => {
      const description = typeof metadata.description === 'string' ? metadata.description : '';

      expect(typeof metadata.title).toBe('string');
      expect(metadata.title).not.toMatch(/Restaurant Management/);
      expect(description.length).toBeGreaterThan(50);
      expect(description.length).toBeLessThanOrEqual(160);
      expect(description).not.toBe(GENERIC_DESCRIPTION);
      expect(metadata.alternates?.canonical).toBe(path);
      expect(metadata.openGraph).toMatchObject({ locale: 'fr_FR', type: 'website', url: path });
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
    },
  );

  it('annonce les tarifs hors taxes, comme le catalogue Stripe', () => {
    const description =
      typeof PRICING_METADATA.description === 'string' ? PRICING_METADATA.description : '';

    expect(description).toContain(`${PLAN_PRICES_EUR.ESSENTIAL} € HT/mois`);
    expect(description).toContain(`${PLAN_PRICES_EUR.PRO} € HT/mois`);
    expect(description).toContain(`${PLAN_PRICES_EUR.PREMIUM} € HT/mois`);
  });
});
