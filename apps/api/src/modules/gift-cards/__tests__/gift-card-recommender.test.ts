import { describe, expect, it } from 'vitest';
import { recommendGiftCardAmount } from '../gift-card-recommender.js';

describe('recommendGiftCardAmount', () => {
  it('recommande un montant selon la fourchette de prix', () => {
    const result = recommendGiftCardAmount({ priceRange: '€', partySize: 2 });
    expect(result.amount).toBe(40);
  });

  it('applique le multiplicateur d occasion', () => {
    const result = recommendGiftCardAmount({
      priceRange: '€€',
      occasion: 'romantique',
      partySize: 2,
    });
    expect(result.amount).toBe(90); // 35 * 2 * 1.3 = 91 → arrondi à 90
  });

  it('arrondit au multiple de 10', () => {
    const result = recommendGiftCardAmount({
      priceRange: '€€€',
      occasion: 'anniversaire',
      partySize: 3,
    });
    expect(result.amount).toBe(200); // 55 * 3 * 1.2 = 198 → arrondi à 200
  });

  it('utilise le fallback sans priceRange', () => {
    const result = recommendGiftCardAmount({ partySize: 2 });
    expect(result.amount).toBe(70); // 35 * 2 = 70
  });

  it('respecte le budget si inferieur au montant recommandé', () => {
    const result = recommendGiftCardAmount({ priceRange: '€€€€', partySize: 2, budget: 100 });
    expect(result.amount).toBe(100); // 85 * 2 = 170, limité par budget 100
  });

  it('genère un message en français avec l occasion', () => {
    const result = recommendGiftCardAmount({ occasion: 'anniversaire', partySize: 2 });
    expect(result.messageSuggestion).toBe('Offrez un moment pour anniversaire au restaurant.');
  });

  it('genère un message par défaut sans occasion', () => {
    const result = recommendGiftCardAmount({ partySize: 2 });
    expect(result.messageSuggestion).toBe('Offrez un moment gourmand au restaurant.');
  });
});
