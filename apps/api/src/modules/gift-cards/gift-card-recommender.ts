import type { GiftCardRecommendation } from './gift-card.types.js';

const priceRangeMap: Record<string, number> = {
  '€': 20,
  '€€': 35,
  '€€€': 55,
  '€€€€': 85,
};

const occasionMultiplier: Record<string, number> = {
  anniversaire: 1.2,
  romantique: 1.3,
  affaires: 1.0,
  remerciement: 1.0,
  départ: 1.1,
  default: 1.0,
};

export function recommendGiftCardAmount(args: {
  priceRange?: string;
  occasion?: string;
  partySize?: number;
  budget?: number;
}): GiftCardRecommendation {
  const { priceRange, occasion, partySize, budget } = args;

  const base = priceRange ? priceRangeMap[priceRange] : undefined;
  const basePerPerson = base ?? 35;
  const multiplier = occasion
    ? (occasionMultiplier[occasion] ?? occasionMultiplier.default)
    : occasionMultiplier.default;
  const party = Math.max(partySize ?? 2, 1);

  const raw = basePerPerson * party * multiplier;
  const amount = Math.round(raw / 10) * 10;

  const messageSuggestion = occasion
    ? `Offrez un moment pour ${occasion} au restaurant.`
    : 'Offrez un moment gourmand au restaurant.';

  const reason = occasion
    ? `Montant basé sur la fourchette ${priceRange ?? 'standard'} et l'occasion « ${occasion} » pour ${party} personne${party > 1 ? 's' : ''}.`
    : `Montant basé sur la fourchette ${priceRange ?? 'standard'} pour ${party} personne${party > 1 ? 's' : ''}.`;

  const finalAmount = budget && budget < amount ? Math.round(budget / 10) * 10 : amount;

  return {
    amount: finalAmount,
    messageSuggestion,
    reason,
  };
}
