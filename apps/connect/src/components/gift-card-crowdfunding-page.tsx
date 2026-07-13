'use client';

/**
 * Sokar Connect — GiftCardCrowdfundingPage.
 *
 * Page publique de contribution à une cagnotte.
 * Accessible sans authentification via le lien partagé.
 *
 * Affiche :
 *   - Le titre, l'occasion, le destinataire
 *   - Le montant collecté (et cible si définie)
 *   - La liste des contributions publiques
 *   - Le formulaire de contribution (montant + Stripe Elements)
 *   - La date butoir
 */

import { useEffect, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe as StripeType } from '@stripe/stripe-js';
import { formatEuro, formatDate } from '@sokar/shared';
import type { CrowdfundingStatus } from '@/lib/api/gift-cards';
import {
  getCrowdfundingStatus,
  createCrowdfundingPaymentIntent,
  contributeToCrowdfunding,
} from '@/lib/api/gift-cards';
import { GiftCardPaymentForm } from './gift-card-payment-form';
import { trackEvent } from '@/lib/tracking';
import { GIFT_CARD_MESSAGE_MAX_LENGTH } from '@/lib/constants/gift-cards';

type Props = {
  code: string;
  primaryColor?: string;
  accentColor?: string;
  source?: string;
};

export function GiftCardCrowdfundingPage({
  code,
  primaryColor = '#0F172A',
  accentColor = '#0284C7',
  source = 'widget',
}: Props) {
  const [status, setStatus] = useState<CrowdfundingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Contribution form state
  const [amount, setAmount] = useState('');
  const [contributorName, setContributorName] = useState('');
  const [contributorEmail, setContributorEmail] = useState('');
  const [isPublicName, setIsPublicName] = useState(true);
  const [message, setMessage] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<StripeType | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [contributing, setContributing] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    getCrowdfundingStatus(code)
      .then(setStatus)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Cagnotte introuvable'),
      )
      .finally(() => setLoading(false));
  }, [code]);

  // Initialiser Stripe.js au montage
  useEffect(() => {
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (pk) {
      setStripePromise(loadStripe(pk));
    }
  }, []);

  const isClosed = status?.status === 'CLOSED' || status?.status === 'CANCELLED';
  const isExpired = status?.crowdfundedUntil && new Date(status.crowdfundedUntil) < new Date();
  const canContribute = !isClosed && !isExpired;

  async function handleStartPayment(e: React.FormEvent) {
    e.preventDefault();
    setContributionError(null);

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setContributionError('Le montant doit être supérieur à 0');
      return;
    }
    if (!contributorName) {
      setContributionError('Veuillez saisir votre nom');
      return;
    }

    setContributing(true);

    trackEvent({
      event: 'crowdfunding_contribute_started',
      code,
      amount: parsedAmount,
      source,
    });

    try {
      const pi = await createCrowdfundingPaymentIntent(code, {
        amount: parsedAmount,
        contributorName,
        contributorEmail: contributorEmail || undefined,
        isPublicName,
        message: message || undefined,
      });
      setClientSecret(pi.clientSecret);
      setPaymentIntentId(pi.paymentIntentId);
      setShowPayment(true);
    } catch (err: unknown) {
      setContributionError(
        err instanceof Error ? err.message : 'Impossible de démarrer le paiement',
      );
    } finally {
      setContributing(false);
    }
  }

  async function handlePaymentSuccess(piId: string) {
    setContributionError(null);
    setContributing(true);

    try {
      await contributeToCrowdfunding(code, {
        paymentIntentId: piId,
        contributorName,
        contributorEmail: contributorEmail || undefined,
        amount: parseFloat(amount),
        isPublicName,
        message: message || undefined,
      });

      setSuccess(true);
      trackEvent({
        event: 'crowdfunding_contribute_completed',
        code,
        amount: parseFloat(amount),
        source,
      });

      // Recharger le statut
      const updated = await getCrowdfundingStatus(code);
      setStatus(updated);
    } catch (err: unknown) {
      setContributionError(
        err instanceof Error ? err.message : 'Contribution impossible. Réessayez.',
      );
    } finally {
      setContributing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-8 rounded-lg bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-24 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error || 'Cagnotte introuvable'}</p>
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="rounded-xl border p-6 text-center"
        style={{ borderColor: `${accentColor}40`, backgroundColor: `${accentColor}08` }}
      >
        <div className="text-3xl">🎉</div>
        <h2 className="mt-2 text-lg font-semibold" style={{ color: primaryColor }}>
          Merci pour votre contribution !
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Votre contribution de {formatEuro(parseFloat(amount))} à la cagnotte « {status.title} » a
          bien été enregistrée.
        </p>
        <button
          type="button"
          onClick={() => {
            setSuccess(false);
            setShowPayment(false);
            setClientSecret(null);
            setPaymentIntentId(null);
            setAmount('');
            setMessage('');
          }}
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold transition-all duration-200 hover:bg-muted"
          style={{ color: primaryColor }}
        >
          Contribuer à nouveau
        </button>
      </div>
    );
  }

  const progress = status.targetAmount
    ? Math.min(100, (status.collectedAmount / status.targetAmount) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: primaryColor }}>
          {status.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cagnotte pour <strong>{status.recipientName}</strong> chez {status.restaurantName}
          {status.occasion ? ` — ${status.occasion}` : ''}
        </p>
        {status.message && (
          <p className="mt-2 text-sm italic text-muted-foreground">« {status.message} »</p>
        )}
      </div>

      {/* Montant collecté */}
      <div
        className="rounded-xl border p-5"
        style={{ borderColor: `${accentColor}30`, backgroundColor: `${accentColor}05` }}
      >
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Montant collecté</p>
            <p className="text-2xl font-bold" style={{ color: accentColor }}>
              {formatEuro(status.collectedAmount)}
            </p>
          </div>
          {status.targetAmount && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Objectif</p>
              <p className="text-lg font-semibold" style={{ color: primaryColor }}>
                {formatEuro(status.targetAmount)}
              </p>
            </div>
          )}
        </div>

        {progress !== null && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, backgroundColor: accentColor }}
            />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {status.contributionsCount} contribution{status.contributionsCount > 1 ? 's' : ''}
          </span>
          <span>Date butoir : {formatDate(status.crowdfundedUntil)}</span>
        </div>
      </div>

      {/* Contributions publiques */}
      {status.contributions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: primaryColor }}>
            Contributions
          </h3>
          <div className="space-y-2">
            {status.contributions.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between rounded-lg border border-border bg-background p-3"
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: primaryColor }}>
                    {c.contributorName ?? 'Anonyme'}
                  </p>
                  {c.message && (
                    <p className="mt-0.5 text-xs text-muted-foreground">« {c.message} »</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(c.contributedAt)}
                  </p>
                </div>
                <p className="text-sm font-semibold" style={{ color: accentColor }}>
                  {formatEuro(c.amount)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulaire de contribution */}
      {canContribute ? (
        <div className="space-y-4">
          <h3 className="text-base font-semibold" style={{ color: primaryColor }}>
            Contribuer à cette cagnotte
          </h3>

          {!showPayment ? (
            <form onSubmit={handleStartPayment} className="space-y-3">
              <div>
                <label className="text-sm font-medium" style={{ color: primaryColor }}>
                  Votre nom *
                </label>
                <input
                  type="text"
                  value={contributorName}
                  onChange={(e) => setContributorName(e.target.value)}
                  placeholder="Ex : Jean"
                  maxLength={100}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium" style={{ color: primaryColor }}>
                  Votre email
                </label>
                <input
                  type="email"
                  value={contributorEmail}
                  onChange={(e) => setContributorEmail(e.target.value)}
                  placeholder="jean@example.com"
                  maxLength={255}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium" style={{ color: primaryColor }}>
                  Montant de votre contribution (€) *
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Ex : 20"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium" style={{ color: primaryColor }}>
                  Message (optionnel)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Un petit mot..."
                  maxLength={GIFT_CARD_MESSAGE_MAX_LENGTH}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-sm" style={{ color: primaryColor }}>
                <input
                  type="checkbox"
                  checked={isPublicName}
                  onChange={(e) => setIsPublicName(e.target.checked)}
                  className="rounded"
                />
                Afficher mon nom publiquement
              </label>

              {contributionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {contributionError}
                </div>
              )}

              <button
                type="submit"
                disabled={contributing}
                className="inline-flex w-full items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: accentColor }}
              >
                {contributing
                  ? 'Chargement...'
                  : `Contribuer ${amount ? formatEuro(parseFloat(amount)) : ''}`}
              </button>
            </form>
          ) : (
            clientSecret &&
            stripePromise && (
              <div className="space-y-3">
                <Elements
                  stripe={stripePromise}
                  options={{ clientSecret, appearance: { theme: 'stripe' } }}
                >
                  <GiftCardPaymentForm
                    clientSecret={clientSecret}
                    amount={parseFloat(amount)}
                    onSuccess={handlePaymentSuccess}
                    onError={(err) => setContributionError(err)}
                    primaryColor={primaryColor}
                    accentColor={accentColor}
                  />
                </Elements>
                <button
                  type="button"
                  onClick={() => {
                    setShowPayment(false);
                    setClientSecret(null);
                    setPaymentIntentId(null);
                  }}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-5 py-2 text-sm font-semibold transition-all duration-200 hover:bg-muted"
                  style={{ color: primaryColor }}
                >
                  ← Retour
                </button>
              </div>
            )
          )}

          {contributing && (
            <p className="text-center text-sm text-muted-foreground">Traitement en cours...</p>
          )}
        </div>
      ) : (
        <div
          className="rounded-xl border p-5 text-center"
          style={{ borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}
        >
          {isClosed ? (
            <p className="text-sm text-muted-foreground">
              Cette cagnotte est clôturée. Le destinataire a reçu sa carte cadeau.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              La date butoir de cette cagnotte est dépassée. Les contributions ne sont plus
              possibles.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
