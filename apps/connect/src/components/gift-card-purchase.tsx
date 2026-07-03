'use client';

/**
 * Sokar Connect — GiftCardPurchase.
 *
 * Flow d'achat d'une carte cadeau en 4 étapes :
 *   1. Choix du type (montant libre ou pack expérience)
 *   2. Informations (expéditeur, destinataire, message)
 *   3. Option "réserver maintenant" (date + party size + heure)
 *   4. Confirmation + achat
 *
 * Après achat, affiche GiftCardConfirmation avec le code complet.
 */

import { useEffect, useState } from 'react';
import type { GiftCardPack, GiftCardPurchaseResult } from '@/lib/api/gift-cards';
import { listGiftCardPacks, purchaseGiftCard } from '@/lib/api/gift-cards';
import { GiftCardConfirmation } from './gift-card-confirmation';
import { trackEvent } from '@/lib/tracking';

type Step = 'type' | 'info' | 'slots' | 'confirm' | 'done';

type Props = {
  slug: string;
  restaurantId: string;
  restaurantName: string;
  primaryColor?: string;
  accentColor?: string;
  source?: string;
};

export function GiftCardPurchase({
  slug,
  restaurantId,
  restaurantName,
  primaryColor = '#0F172A',
  accentColor = '#EA580C',
  source = 'widget',
}: Props) {
  const [step, setStep] = useState<Step>('type');
  const [packs, setPacks] = useState<GiftCardPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);

  // Form state
  const [mode, setMode] = useState<'free' | 'pack'>('free');
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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GiftCardPurchaseResult | null>(null);

  useEffect(() => {
    listGiftCardPacks(slug)
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setPacksLoading(false));
  }, [slug]);

  function handleNextFromType() {
    setError(null);
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
    setStep(bookNow ? 'slots' : 'confirm');
  }

  function handleNextFromSlots() {
    setError(null);
    if (bookNow && !preferredDate) {
      setError('Veuillez choisir une date préférée');
      return;
    }
    setStep('confirm');
  }

  async function handlePurchase() {
    if (honeypot) {
      // Bot detected. Silent fail.
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
      const input: Parameters<typeof purchaseGiftCard>[0] = {
        restaurantId,
        occasion: occasion || undefined,
        senderName: senderName || undefined,
        senderEmail: senderEmail || undefined,
        senderPhone: senderPhone || undefined,
        recipientName: recipientName || undefined,
        recipientEmail: recipientEmail || undefined,
        recipientPhone: recipientPhone || undefined,
        message: message || undefined,
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
    } catch (err: any) {
      setError(err.message || 'Achat impossible. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  const widgetStyle = {
    '--widget-primary': primaryColor,
    '--widget-accent': accentColor,
  } as React.CSSProperties;

  if (step === 'done' && result) {
    return (
      <div style={widgetStyle}>
        <GiftCardConfirmation
          result={result}
          restaurantName={restaurantName}
          bookNow={bookNow}
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      </div>
    );
  }

  const selectedPack = packs.find((p) => p.id === packId);
  const displayAmount = mode === 'free' ? parseFloat(amount) || 0 : (selectedPack?.amount ?? 0);

  return (
    <div style={widgetStyle} className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs">
        {(['type', 'info', 'slots', 'confirm'] as Step[])
          .filter((s) => s !== 'done')
          .map((s, idx) => {
            const stepOrder = ['type', 'info', 'slots', 'confirm'];
            const currentIdx = stepOrder.indexOf(step);
            const isActive = idx === currentIdx;
            const isDone = idx < currentIdx;
            if (s === 'slots' && !bookNow) return null;

            return (
              <div key={s} className="flex items-center gap-2">
                {idx > 0 && (
                  <div
                    className={`h-px w-6 ${isDone ? 'bg-[var(--widget-accent)]' : 'bg-border'}`}
                  />
                )}
                <span
                  className={`rounded-full px-2 py-0.5 font-medium transition-all duration-200 ${
                    isActive
                      ? 'text-white'
                      : isDone
                        ? 'text-[var(--widget-accent)]'
                        : 'text-muted-foreground'
                  }`}
                  style={isActive ? { backgroundColor: accentColor } : undefined}
                >
                  {idx + 1}
                </span>
              </div>
            );
          })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Étape 1 : Type */}
      {step === 'type' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold" style={{ color: primaryColor }}>
            Choisissez le type de carte
          </h2>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setMode('free')}
              className={`flex w-full items-center justify-between rounded-lg border p-4 transition-all duration-200 ${
                mode === 'free' ? 'border-2' : 'border-border bg-background hover:bg-muted'
              }`}
              style={mode === 'free' ? { borderColor: accentColor } : undefined}
            >
              <div className="text-left">
                <p className="font-medium" style={{ color: primaryColor }}>
                  Montant libre
                </p>
                <p className="text-sm text-muted-foreground">
                  Choisissez le montant de votre choix
                </p>
              </div>
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                  mode === 'free' ? 'border-transparent text-white' : 'border-border'
                }`}
                style={mode === 'free' ? { backgroundColor: accentColor } : undefined}
              >
                {mode === 'free' && '✓'}
              </div>
            </button>

            <button
              type="button"
              onClick={() => packs.length > 0 && setMode('pack')}
              disabled={packsLoading || packs.length === 0}
              className={`flex w-full items-center justify-between rounded-lg border p-4 transition-all duration-200 disabled:opacity-50 ${
                mode === 'pack' ? 'border-2' : 'border-border bg-background hover:bg-muted'
              }`}
              style={mode === 'pack' ? { borderColor: accentColor } : undefined}
            >
              <div className="text-left">
                <p className="font-medium" style={{ color: primaryColor }}>
                  Pack expérience
                </p>
                <p className="text-sm text-muted-foreground">
                  {packsLoading
                    ? 'Chargement...'
                    : packs.length === 0
                      ? 'Aucun pack disponible'
                      : `${packs.length} pack${packs.length > 1 ? 's' : ''} disponible${packs.length > 1 ? 's' : ''}`}
                </p>
              </div>
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                  mode === 'pack' ? 'border-transparent text-white' : 'border-border'
                }`}
                style={mode === 'pack' ? { backgroundColor: accentColor } : undefined}
              >
                {mode === 'pack' && '✓'}
              </div>
            </button>
          </div>

          {mode === 'free' && (
            <div>
              <label className="block text-sm font-medium" style={{ color: primaryColor }}>
                Montant (€)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                placeholder="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
            </div>
          )}

          {mode === 'pack' && packs.length > 0 && (
            <div className="space-y-2">
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setPackId(pack.id)}
                  className={`flex w-full items-center justify-between rounded-lg border p-4 transition-all duration-200 ${
                    packId === pack.id ? 'border-2' : 'border-border bg-background hover:bg-muted'
                  }`}
                  style={packId === pack.id ? { borderColor: accentColor } : undefined}
                >
                  <div className="text-left">
                    <p className="font-medium" style={{ color: primaryColor }}>
                      {pack.name}
                    </p>
                    {pack.description && (
                      <p className="text-sm text-muted-foreground">{pack.description}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pack.minPartySize === pack.maxPartySize
                        ? `${pack.minPartySize} pers.`
                        : `${pack.minPartySize}–${pack.maxPartySize} pers.`}
                    </p>
                  </div>
                  <p className="font-semibold" style={{ color: accentColor }}>
                    {formatEuro(pack.amount)}
                  </p>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleNextFromType}
            disabled={packsLoading}
            className="inline-flex w-full items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            Continuer
          </button>
        </div>
      )}

      {/* Étape 2 : Informations */}
      {step === 'info' && (
        <div className="space-y-4">
          {/* Honeypot anti-bot — caché visuellement */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />

          <h2 className="text-lg font-semibold" style={{ color: primaryColor }}>
            Informations
          </h2>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Occasion (optionnel)
            </label>
            <input
              type="text"
              placeholder="Anniversaire, remerciement..."
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
            />
          </div>

          <div className="rounded-lg border border-border bg-cream p-3">
            <p className="mb-3 text-sm font-medium" style={{ color: primaryColor }}>
              Expéditeur
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Nom"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
              <input
                type="email"
                placeholder="Email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
              <input
                type="tel"
                placeholder="Téléphone"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-cream p-3">
            <p className="mb-3 text-sm font-medium" style={{ color: primaryColor }}>
              Destinataire
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Nom"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
              <input
                type="email"
                placeholder="Email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
              <input
                type="tel"
                placeholder="Téléphone"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Message personnalisé (optionnel)
            </label>
            <textarea
              placeholder="Joyeux anniversaire !"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
            />
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-border bg-cream p-3 cursor-pointer transition-all duration-200 hover:bg-muted">
            <input
              type="checkbox"
              checked={bookNow}
              onChange={(e) => setBookNow(e.target.checked)}
              className="h-4 w-4 rounded"
              style={{ accentColor }}
            />
            <div>
              <p className="text-sm font-medium" style={{ color: primaryColor }}>
                Proposer directement des créneaux au destinataire
              </p>
              <p className="text-xs text-muted-foreground">
                Le destinataire verra 3 créneaux et pourra réserver en un clic.
              </p>
            </div>
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('type')}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-base font-semibold transition-all duration-200 hover:bg-muted"
              style={{ color: primaryColor }}
            >
              ← Retour
            </button>
            <button
              type="button"
              onClick={handleNextFromInfo}
              className="inline-flex flex-1 items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90"
              style={{ backgroundColor: accentColor }}
            >
              Continuer
            </button>
          </div>
        </div>
      )}

      {/* Étape 3 : Créneaux (optionnel) */}
      {step === 'slots' && bookNow && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold" style={{ color: primaryColor }}>
            Préférences de réservation
          </h2>
          <p className="text-sm text-muted-foreground">
            Ces informations aideront à proposer les meilleurs créneaux au destinataire.
          </p>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Date préférée
            </label>
            <input
              type="date"
              min={todayIso()}
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Nombre de personnes
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={preferredPartySize}
              onChange={(e) => setPreferredPartySize(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Heure préférée (optionnel)
            </label>
            <input
              type="time"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('info')}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-base font-semibold transition-all duration-200 hover:bg-muted"
              style={{ color: primaryColor }}
            >
              ← Retour
            </button>
            <button
              type="button"
              onClick={handleNextFromSlots}
              className="inline-flex flex-1 items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90"
              style={{ backgroundColor: accentColor }}
            >
              Continuer
            </button>
          </div>
        </div>
      )}

      {/* Étape 4 : Confirmation */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold" style={{ color: primaryColor }}>
            Récapitulatif
          </h2>

          <div className="rounded-xl border border-border bg-cream p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium" style={{ color: primaryColor }}>
                {mode === 'free' ? 'Montant libre' : `Pack : ${selectedPack?.name ?? '—'}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Montant</span>
              <span className="font-semibold" style={{ color: accentColor }}>
                {formatEuro(displayAmount)}
              </span>
            </div>
            {recipientName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Destinataire</span>
                <span style={{ color: primaryColor }}>{recipientName}</span>
              </div>
            )}
            {bookNow && preferredDate && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date préférée</span>
                <span style={{ color: primaryColor }}>{preferredDate}</span>
              </div>
            )}
            {bookNow && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Personnes</span>
                <span style={{ color: primaryColor }}>{preferredPartySize}</span>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Mode test : aucun paiement réel ne sera effectué. La carte cadeau sera créée
            immédiatement.
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(bookNow ? 'slots' : 'info')}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-base font-semibold transition-all duration-200 hover:bg-muted disabled:opacity-50"
              style={{ color: primaryColor }}
            >
              ← Retour
            </button>
            <button
              type="button"
              onClick={handlePurchase}
              disabled={loading}
              className="inline-flex flex-1 items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {loading ? 'Achat...' : `Acheter — ${formatEuro(displayAmount)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}
