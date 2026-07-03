import type { GiftCard } from '@prisma/client';

export type GiftCardStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export type GiftCardCreatedBy = 'CLIENT' | 'DASHBOARD' | 'VOICE';

export type CreateGiftCardInput = {
  restaurantId: string;
  amount: number;
  currency?: string;
  expiresAt?: Date;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  message?: string;
  voiceMessageUrl?: string;
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
};

export type GiftCardRecommendation = {
  amount: number;
  messageSuggestion: string;
  reason: string;
};
