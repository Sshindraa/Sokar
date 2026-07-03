import type { GiftCard, GiftCardPack } from '@prisma/client';

export type GiftCardStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export type GiftCardCreatedBy = 'CLIENT' | 'DASHBOARD' | 'VOICE';

export type CreateGiftCardInput = {
  restaurantId: string;
  amount?: number;
  currency?: string;
  expiresAt?: Date;
  validityMonths?: number;
  packId?: string;
  preferredDate?: Date;
  preferredTime?: string;
  preferredPartySize?: number;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  message?: string;
  occasion?: string;
  customerId?: string;
  createdBy?: GiftCardCreatedBy;
  purchaseReference?: string;
};

export type GiftCardValidationResult =
  | { valid: true; giftCard: GiftCard }
  | { valid: false; reason: GiftCardValidationError };

export type GiftCardValidationError =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FULLY_REDEEMED'
  | 'WRONG_RESTAURANT';

export type ApplyGiftCardInput = {
  code: string;
  restaurantId: string;
  reservationId: string;
  reservationAmount: number;
};

export type GiftCardApplicationPaymentStatus = 'FULLY_COVERED' | 'PARTIAL' | 'COMPLEMENT_REQUIRED';

export type GiftCardApplicationResult = {
  reservationId: string;
  giftCardId: string;
  appliedAmount: number;
  remainingAmount: number;
  paymentStatus: GiftCardApplicationPaymentStatus;
  complementAmount: number;
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

export type GiftCardRecommendation = {
  amount: number;
  messageSuggestion: string;
  reason: string;
};

export type CreateGiftCardPackInput = {
  restaurantId: string;
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

export type GiftCardSlot = {
  date: string;
  time: string;
  tableId?: string;
};

export type BookGiftCardSlotInput = {
  code: string;
  slotIndex: number;
  customer: {
    firstName: string;
    lastName?: string;
    phone: string;
    email?: string;
  };
};

export type GiftCardWithPack = GiftCard & { pack: GiftCardPack | null };

export type GiftCardBookResult = {
  reservationId: string;
  state: string;
  giftCardApplication?: GiftCardApplicationResult;
};
