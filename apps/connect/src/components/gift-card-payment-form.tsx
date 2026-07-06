'use client';

/**
 * Sokar Connect — GiftCardPaymentForm.
 *
 * Formulaire de paiement Stripe Elements.
 * Affiche le PaymentElement, gère la confirmation du paiement et les erreurs.
 *
 * Design aligné avec le widget de réservation Sokar.
 */

import { useState, type CSSProperties } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CreditCard, Loader2, Lock, AlertCircle } from 'lucide-react';

type Props = {
  clientSecret: string;
  amount: number;
  onSuccess: (paymentIntentId: string) => void;
  onError: (error: string) => void;
  primaryColor?: string;
  accentColor?: string;
};

const reservationTheme: CSSProperties & Record<`--${string}`, string> = {
  '--reservation-bg': '34 32% 92%',
  '--reservation-wash': '34 38% 96%',
  '--reservation-panel': '0 0% 100%',
  '--reservation-ink': '24 10% 10%',
  '--reservation-soft': '24 6% 42%',
  '--reservation-muted': '24 5% 64%',
  '--reservation-line': '28 20% 88%',
  '--reservation-glow': '31 92% 62%',
};

export function GiftCardPaymentForm({
  amount,
  onSuccess,
  onError,
  primaryColor = '#0F172A',
  accentColor = '#0284C7',
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (error) {
        setErrorMessage(error.message ?? 'Une erreur est survenue lors du paiement.');
        onError(error.message ?? 'Paiement échoué');
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        onSuccess(paymentIntent.id);
      } else {
        setErrorMessage('Le paiement est en cours de traitement. Veuillez réessayer.');
        onError('Paiement en cours de traitement');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      setErrorMessage(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={reservationTheme} className="space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard size={18} className="text-[hsl(var(--reservation-blue))]" />
        <h3 className="font-display text-[1.25rem] font-black tracking-[-0.03em] text-[hsl(var(--reservation-ink))]">
          Paiement
        </h3>
      </div>

      <div className="rounded-2xl border border-[hsl(var(--reservation-line))] bg-white/70 p-4 backdrop-blur-sm">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200/80 bg-red-50/80 p-4 backdrop-blur-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-[13px] font-medium leading-snug text-red-700">{errorMessage}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || loading}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[17px] font-extrabold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Traitement...
          </>
        ) : (
          <>
            <Lock size={16} />
            Payer {formatEuro(amount)}
          </>
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-[hsl(var(--reservation-muted))]">
        <Lock size={11} />
        Paiement sécurisé par Stripe
      </p>
    </form>
  );
}

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}
