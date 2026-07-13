/**
 * Hook useGiftCardFlow — encapsule tout l'état et la logique du flow
 * d'achat de carte cadeau multi-étapes.
 *
 * Extrait de gift-card-purchase.tsx pour respecter le SRP.
 * Le composant principal devient un orchestrator qui délègue à ce hook
 * + aux sous-composants d'étape.
 */

import { useEffect, useState } from 'react';
import { loadStripe, type Stripe as StripeType } from '@stripe/stripe-js';
import type { GiftCardPack, GiftCardPurchaseResult } from '@/lib/api/gift-cards';
import { listGiftCardPacks, createPaymentIntent, purchaseGiftCard } from '@/lib/api/gift-cards';
import { trackEvent } from '@/lib/tracking';

export type GiftCardStep =
  | 'type'
  | 'info'
  | 'slots'
  | 'template'
  | 'payment'
  | 'done'
  | 'crowdfunding';

export type GiftCardMode = 'free' | 'pack' | 'crowdfunding';

export type UseGiftCardFlowProps = {
  slug: string;
  restaurantId: string;
  source?: string;
};

export function useGiftCardFlow({ slug, restaurantId, source = 'widget' }: UseGiftCardFlowProps) {
  const [step, setStep] = useState<GiftCardStep>('type');
  const [packs, setPacks] = useState<GiftCardPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);

  // Form state
  const [mode, setMode] = useState<GiftCardMode>('free');
  const [amount, setAmount] = useState('');
  const [packId, setPackId] = useState('');
  const [occasion, setOccasion] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [message, setMessage] = useState('');
  const [bookNow, setBookNow] = useState(false);
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredPartySize, setPreferredPartySize] = useState('2');
  const [preferredTime, setPreferredTime] = useState('');
  // Honeypot (anti-bot). Si rempli, on bloque la soumission.
  const [honeypot, setHoneypot] = useState('');

  // Template + paiement
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [customImageUrl, setCustomImageUrl] = useState<string | undefined>(undefined);
  const [stripePromise, setStripePromise] = useState<Promise<StripeType | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GiftCardPurchaseResult | null>(null);

  useEffect(() => {
    listGiftCardPacks(slug)
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setPacksLoading(false));
  }, [slug]);

  // Initialiser Stripe.js au montage
  useEffect(() => {
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (pk) {
      setStripePromise(loadStripe(pk));
    }
  }, []);

  function handleNextFromType() {
    setError(null);
    if (mode === 'crowdfunding') {
      return;
    }
    if (mode === 'free') {
      const parsed = parseFloat(amount);
      if (!parsed || parsed <= 0) {
        setError('Le montant doit être supérieur à 0');
        return;
      }
    } else {
      if (!packId) {
        setError('Veuillez sélectionner un pack');
        return;
      }
    }
    setStep('info');
  }

  function handleNextFromInfo() {
    setError(null);
    setStep(bookNow ? 'slots' : 'template');
  }

  function handleNextFromSlots() {
    setError(null);
    if (bookNow && !preferredDate) {
      setError('Veuillez choisir une date préférée');
      return;
    }
    setStep('template');
  }

  function handleNextFromTemplate() {
    setError(null);
    setStep('payment');
  }

  async function handleStartPayment() {
    if (honeypot) {
      setError('Une erreur est survenue. Réessayez.');
      return;
    }
    setError(null);
    setLoading(true);

    trackEvent({
      event: 'gift_card_purchase_started',
      restaurantId,
      restaurantSlug: slug,
      source,
    });

    try {
      const piInput: Parameters<typeof createPaymentIntent>[0] = { restaurantId };
      if (mode === 'free') {
        piInput.amount = parseFloat(amount);
      } else {
        piInput.packId = packId;
      }

      const pi = await createPaymentIntent(piInput);
      setClientSecret(pi.clientSecret);
      setPaymentIntentId(pi.paymentIntentId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible de démarrer le paiement. Réessayez.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handlePaymentSuccess(piId: string) {
    setError(null);
    setLoading(true);

    try {
      const input: Parameters<typeof purchaseGiftCard>[0] = {
        restaurantId,
        paymentIntentId: piId,
        occasion: occasion || undefined,
        senderName: senderName || undefined,
        senderEmail: senderEmail || undefined,
        senderPhone: senderPhone || undefined,
        recipientName: recipientName || undefined,
        recipientEmail: recipientEmail || undefined,
        recipientPhone: recipientPhone || undefined,
        message: message || undefined,
        templateId: templateId ?? undefined,
        customImageUrl,
      };

      if (mode === 'free') {
        input.amount = parseFloat(amount);
      } else {
        input.packId = packId;
      }

      if (bookNow) {
        input.preferredDate = preferredDate || undefined;
        input.preferredTime = preferredTime || undefined;
        input.preferredPartySize = parseInt(preferredPartySize, 10) || undefined;
      }

      const res = await purchaseGiftCard(input);
      setResult(res);
      setStep('done');

      trackEvent({
        event: 'gift_card_purchase_completed',
        restaurantId,
        restaurantSlug: slug,
        giftCardId: res.id,
        amount: res.amount,
        source,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Achat impossible. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  return {
    // Step state
    step,
    setStep,
    packs,
    packsLoading,
    mode,
    setMode,
    amount,
    setAmount,
    packId,
    setPackId,
    occasion,
    setOccasion,
    senderName,
    setSenderName,
    senderEmail,
    setSenderEmail,
    senderPhone,
    setSenderPhone,
    recipientName,
    setRecipientName,
    recipientEmail,
    setRecipientEmail,
    recipientPhone,
    setRecipientPhone,
    message,
    setMessage,
    bookNow,
    setBookNow,
    preferredDate,
    setPreferredDate,
    preferredPartySize,
    setPreferredPartySize,
    preferredTime,
    setPreferredTime,
    honeypot,
    setHoneypot,
    templateId,
    setTemplateId,
    customImageUrl,
    setCustomImageUrl,
    stripePromise,
    clientSecret,
    setClientSecret,
    paymentIntentId,
    setPaymentIntentId,
    loading,
    error,
    setError,
    result,
    // Handlers
    handleNextFromType,
    handleNextFromInfo,
    handleNextFromSlots,
    handleNextFromTemplate,
    handleStartPayment,
    handlePaymentSuccess,
  };
}

export type GiftCardFlow = ReturnType<typeof useGiftCardFlow>;
