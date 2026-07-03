'use client';

import { useApi } from '../api';

export type GiftCardListItem = {
  id: string;
  code: string;
  amount: number;
  remainingAmount: number;
  status: string;
  packId: string | null;
  packName: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  senderName: string | null;
  message: string | null;
  occasion: string | null;
  createdBy: string;
  purchasedAt: string;
  expiresAt: string | null;
  stripePaymentStatus: string | null;
  sokarCommissionAmount: number;
};

export type GiftCardListResponse = {
  items: GiftCardListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type GiftCardStats = {
  totalSoldAmount: number;
  totalRemainingAmount: number;
  redeemedCount: number;
  activeCount: number;
  totalCount: number;
  averageAmount: number;
  packCount: number;
  freeAmountCount: number;
};

export type GiftCardPack = {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  minPartySize: number;
  maxPartySize: number;
  isActive: boolean;
};

export type CreateGiftCardInput = {
  amount?: number;
  packId?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  senderName?: string;
  message?: string;
  occasion?: string;
  expiresAt?: string;
};

export type CreateGiftCardPackInput = {
  name: string;
  description?: string;
  amount: number;
  minPartySize?: number;
  maxPartySize?: number;
};

export type UpdateGiftCardPackInput = {
  name?: string;
  description?: string | null;
  amount?: number;
  minPartySize?: number;
  maxPartySize?: number;
};

export function useGiftCardApi() {
  const { get, post, patch, orgId } = useApi();

  async function listGiftCards(params?: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<GiftCardListResponse> {
    if (!orgId) throw new Error('Organisation non chargée');
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return get<GiftCardListResponse>(`restaurants/${orgId}/gift-cards${query ? `?${query}` : ''}`);
  }

  async function createGiftCard(input: CreateGiftCardInput): Promise<GiftCardListItem> {
    if (!orgId) throw new Error('Organisation non chargée');
    return post<GiftCardListItem>(`restaurants/${orgId}/gift-cards`, input);
  }

  async function cancelGiftCard(giftCardId: string): Promise<GiftCardListItem> {
    if (!orgId) throw new Error('Organisation non chargée');
    return post<GiftCardListItem>(`restaurants/${orgId}/gift-cards/${giftCardId}/cancel`);
  }

  async function getGiftCardStats(): Promise<GiftCardStats> {
    if (!orgId) throw new Error('Organisation non chargée');
    return get<GiftCardStats>(`restaurants/${orgId}/gift-cards/stats`);
  }

  async function listGiftCardPacks(): Promise<GiftCardPack[]> {
    if (!orgId) throw new Error('Organisation non chargée');
    return get<GiftCardPack[]>(`restaurants/${orgId}/gift-card-packs`);
  }

  async function createGiftCardPack(input: CreateGiftCardPackInput): Promise<GiftCardPack> {
    if (!orgId) throw new Error('Organisation non chargée');
    return post<GiftCardPack>(`restaurants/${orgId}/gift-card-packs`, input);
  }

  async function updateGiftCardPack(
    packId: string,
    input: UpdateGiftCardPackInput,
  ): Promise<GiftCardPack> {
    if (!orgId) throw new Error('Organisation non chargée');
    return patch<GiftCardPack>(`restaurants/${orgId}/gift-card-packs/${packId}`, input);
  }

  async function toggleGiftCardPack(packId: string): Promise<GiftCardPack> {
    if (!orgId) throw new Error('Organisation non chargée');
    return post<GiftCardPack>(`restaurants/${orgId}/gift-card-packs/${packId}/toggle`);
  }

  return {
    orgId,
    listGiftCards,
    createGiftCard,
    cancelGiftCard,
    getGiftCardStats,
    listGiftCardPacks,
    createGiftCardPack,
    updateGiftCardPack,
    toggleGiftCardPack,
  };
}
