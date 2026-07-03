/**
 * Sokar Connect — Gift card API client.
 *
 * Fonctions pour appeler les routes publiques des cartes cadeaux.
 * Utilise fetchWithTimeout pour tous les appels.
 */

const FETCH_TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.API_URL ?? 'http://localhost:3001';
  }
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001';
}

export type GiftCardRecommendation = {
  amount: number;
  messageSuggestion: string;
  reason: string;
};

export type GiftCardPack = {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  minPartySize: number;
  maxPartySize: number;
};

export type GiftCardPurchaseInput = {
  restaurantId: string;
  paymentIntentId: string;
  amount?: number;
  packId?: string;
  occasion?: string;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  message?: string;
  templateId?: string;
  customImageUrl?: string;
  preferredDate?: string;
  preferredTime?: string;
  preferredPartySize?: number;
};

export type GiftCardPurchaseResult = {
  id: string;
  code: string;
  amount: number;
  remainingAmount: number;
  status: string;
  packName: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  preferredPartySize: number | null;
  stripePaymentStatus: string | null;
  pdfUrl: string | null;
};

export type PaymentIntentResult = {
  paymentIntentId: string;
  clientSecret: string;
};

export type GiftCardSlot = {
  date: string;
  time: string;
};

export type GiftCardBookInput = {
  slotIndex: number;
  customer: {
    firstName: string;
    lastName?: string;
    phone: string;
    email?: string;
  };
};

export type GiftCardBookResult = {
  reservationId: string;
  state: string;
  giftCardApplication?: unknown;
};

export async function recommendGiftCard(input: {
  restaurantId?: string;
  priceRange?: string;
  occasion?: string;
  partySize?: number;
  budget?: number;
}): Promise<GiftCardRecommendation> {
  const res = await fetchWithTimeout(`${getApiUrl()}/public/gift-cards/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Impossible de charger la recommandation');
  return res.json();
}

export async function listGiftCardPacks(slug: string): Promise<GiftCardPack[]> {
  const res = await fetchWithTimeout(`${getApiUrl()}/public/gift-cards/packs/${slug}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createPaymentIntent(input: {
  restaurantId: string;
  amount?: number;
  packId?: string;
}): Promise<PaymentIntentResult> {
  const res = await fetchWithTimeout(`${getApiUrl()}/public/gift-cards/payment-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Impossible de créer le paiement');
  }
  return res.json();
}

export async function purchaseGiftCard(
  input: GiftCardPurchaseInput,
): Promise<GiftCardPurchaseResult> {
  const res = await fetchWithTimeout(`${getApiUrl()}/public/gift-cards/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Achat impossible. Réessayez.');
  }
  return res.json();
}

export async function suggestGiftCardSlots(
  code: string,
  input?: { partySize?: number; preferredDate?: string; preferredTime?: string },
): Promise<{ slots: GiftCardSlot[] }> {
  const res = await fetchWithTimeout(`${getApiUrl()}/public/gift-cards/${code}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Impossible de charger les créneaux');
  }
  return res.json();
}

export async function bookGiftCardSlot(
  code: string,
  input: GiftCardBookInput,
): Promise<GiftCardBookResult> {
  const res = await fetchWithTimeout(`${getApiUrl()}/public/gift-cards/${code}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Réservation impossible. Réessayez.');
  }
  return res.json();
}
