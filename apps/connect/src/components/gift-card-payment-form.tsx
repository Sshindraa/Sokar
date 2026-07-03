'use client';

/**
 * Sokar Connect — GiftCardPaymentForm.
 *
 * Formulaire de paiement Stripe Elements.
 * Affiche le CardElement, gère la confirmation du paiement et les erreurs.
 */

import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

type Props = {
  clientSecret: string;
  amount: number;
  onSuccess: (paymentIntentId: string) => void;
  onError: (error: string) => void;
  primaryColor?: string;
  accentColor?: string;
};

export function GiftCardPaymentForm({
  amount,
  onSuccess,
  onError,
  primaryColor = '#0F172A',
  accentColor = '#EA580C',
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold" style={{ color: primaryColor }}>
          Paiement
        </h3>
        <p className="text-sm text-muted-foreground">
          Montant à payer : <strong style={{ color: accentColor }}>{amount}€</strong>
        </p>
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full rounded-lg px-4 py-3 font-semibold text-white transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ backgroundColor: accentColor }}
      >
        {loading ? 'Traitement...' : `Payer ${amount}€`}
      </button>

      <p className="text-center text-xs text-muted-foreground">Paiement sécurisé par Stripe 🔒</p>
    </form>
  );
}
