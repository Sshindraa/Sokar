'use client';

import { ChevronLeft, CreditCard, Loader2 } from 'lucide-react';
import { Elements } from '@stripe/react-stripe-js';
import { GiftCardPaymentForm } from '../gift-card-payment-form';
import { primaryBtnClass, secondaryBtnClass, panelClass, headingClass, formatEuro } from './shared';
import type { GiftCardFlow } from './use-gift-card-flow';
import type { GiftCardPack } from '@/lib/api/gift-cards';

type Props = {
  flow: GiftCardFlow;
  selectedPack?: GiftCardPack;
  displayAmount: number;
  primaryColor: string;
  accentColor: string;
};

export function GiftCardPaymentStep({
  flow,
  selectedPack,
  displayAmount,
  primaryColor,
  accentColor,
}: Props) {
  const {
    bookNow,
    mode,
    recipientName,
    preferredDate,
    preferredPartySize,
    loading,
    clientSecret,
    stripePromise,
    setClientSecret,
    setPaymentIntentId,
    setStep,
    setError,
    handleStartPayment,
    handlePaymentSuccess,
  } = flow;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
          Étape {bookNow ? '5' : '4'}
        </p>
        <h2 className={headingClass}>Récapitulatif & Paiement</h2>
      </div>

      {/* Récap glassmorphism */}
      <div className={panelClass}>
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
              Type
            </span>
            <span className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
              {mode === 'free' ? 'Montant libre' : `Pack : ${selectedPack?.name ?? '—'}`}
            </span>
          </div>
          <div className="h-px bg-[hsl(var(--reservation-line))]" />
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
              Montant
            </span>
            <span className="font-display text-[1.5rem] font-black tracking-tight text-[hsl(var(--reservation-blue))]">
              {formatEuro(displayAmount)}
            </span>
          </div>
          {recipientName && (
            <>
              <div className="h-px bg-[hsl(var(--reservation-line))]" />
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
                  Destinataire
                </span>
                <span className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
                  {recipientName}
                </span>
              </div>
            </>
          )}
          {bookNow && preferredDate && (
            <>
              <div className="h-px bg-[hsl(var(--reservation-line))]" />
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
                  Date préférée
                </span>
                <span className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
                  {preferredDate}
                </span>
              </div>
            </>
          )}
          {bookNow && (
            <>
              <div className="h-px bg-[hsl(var(--reservation-line))]" />
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
                  Personnes
                </span>
                <span className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
                  {preferredPartySize}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {!clientSecret && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleStartPayment}
            disabled={loading}
            className={primaryBtnClass}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Chargement...
              </>
            ) : (
              <>
                <CreditCard size={18} />
                Payer {formatEuro(displayAmount)}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStep('template')}
            disabled={loading}
            className={secondaryBtnClass}
          >
            <ChevronLeft size={18} />
            Retour
          </button>
        </div>
      )}

      {clientSecret && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance: { theme: 'stripe' } }}
        >
          <GiftCardPaymentForm
            clientSecret={clientSecret}
            amount={displayAmount}
            onSuccess={handlePaymentSuccess}
            onError={(err) => setError(err)}
            primaryColor={primaryColor}
            accentColor={accentColor}
          />
          <button
            type="button"
            onClick={() => {
              setClientSecret(null);
              setPaymentIntentId(null);
              setStep('template');
            }}
            className={`${secondaryBtnClass} mt-3`}
          >
            <ChevronLeft size={18} />
            Retour
          </button>
        </Elements>
      )}

      {loading && (
        <p className="text-center text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
          Traitement en cours...
        </p>
      )}
    </div>
  );
}
