'use client';

/**
 * Sokar Connect — GiftCardPurchase.
 *
 * Flow d'achat d'une carte cadeau en 6 étapes :
 *   1. Choix du type (montant libre ou pack expérience)
 *   2. Informations (expéditeur, destinataire, message)
 *   3. Option "réserver maintenant" (date + party size + heure)
 *   4. Design (template ou image personnalisée)
 *   5. Paiement (Stripe Elements)
 *   6. Confirmation + achat
 *
 * Design aligné avec le widget de réservation Sokar :
 *   - Background cream avec décorations gradient
 *   - Panneaux glassmorphism (backdrop-blur, border-white/70)
 *   - Boutons rounded-full avec hover lift et active scale
 *   - Display font (Outfit) pour les titres, tracking tight
 *   - Icônes Lucide au lieu d'emojis
 *   - Labels uppercase tracking-wide
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe as StripeType } from '@stripe/stripe-js';
import {
  Gift,
  ChevronLeft,
  ChevronRight,
  Check,
  CreditCard,
  Sparkles,
  Users,
  Calendar,
  Clock,
  AlertCircle,
  Loader2,
  PartyPopper,
  Heart,
} from 'lucide-react';
import type { GiftCardPack, GiftCardPurchaseResult } from '@/lib/api/gift-cards';
import { listGiftCardPacks, createPaymentIntent, purchaseGiftCard } from '@/lib/api/gift-cards';
import { GiftCardConfirmation } from './gift-card-confirmation';
import { GiftCardTemplatePicker } from './gift-card-template-picker';
import { GiftCardPaymentForm } from './gift-card-payment-form';
import { GiftCardCrowdfundingCreate } from './gift-card-crowdfunding-create';
import { trackEvent } from '@/lib/tracking';

type Step = 'type' | 'info' | 'slots' | 'template' | 'payment' | 'done' | 'crowdfunding';

type Props = {
  slug: string;
  restaurantId: string;
  restaurantName: string;
  primaryColor?: string;
  accentColor?: string;
  source?: string;
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
  '--reservation-success': '142 70% 38%',
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
  const [mode, setMode] = useState<'free' | 'pack' | 'crowdfunding'>('free');
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
    } catch (err: any) {
      setError(err.message || 'Impossible de démarrer le paiement. Réessayez.');
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
    } catch (err: any) {
      setError(err.message || 'Achat impossible. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  const widgetStyle = {
    ...reservationTheme,
    '--widget-primary': primaryColor,
    '--widget-accent': accentColor,
  } as CSSProperties;

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

  const stepOrder: Step[] = ['type', 'info', 'slots', 'template', 'payment'];
  const currentIdx = stepOrder.indexOf(step);
  const visibleSteps = stepOrder.filter((s) => s !== 'slots' || bookNow);

  // Shared button classes — palette Sokar : ink (near-black) pour primary, pas orange
  const primaryBtnClass =
    'flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[17px] font-extrabold text-white shadow-lg shadow-black/10 transition-all duration-200 active:scale-[0.97] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
  const secondaryBtnClass =
    'flex h-12 w-full items-center justify-center gap-1.5 rounded-full border border-[hsl(var(--reservation-line))] bg-white/70 text-[14px] font-bold text-[hsl(var(--reservation-ink))] shadow-sm transition-all duration-200 hover:bg-white active:scale-[0.98]';

  // Shared input class — focus ring blue comme le widget résa
  const inputClass =
    'w-full rounded-xl border border-[hsl(var(--reservation-line))] bg-white/70 px-4 py-3 text-[15px] font-medium text-[hsl(var(--reservation-ink))] placeholder:text-[hsl(var(--reservation-muted))] transition-all duration-200 focus:border-white/80 focus:bg-white/62 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';

  // Shared panel class (glassmorphism)
  const panelClass =
    'rounded-[1.25rem] border border-white/70 bg-white/60 p-5 backdrop-blur-2xl shadow-sm';

  // Shared section heading
  const headingClass =
    'font-display text-[1.5rem] font-black leading-tight tracking-[-0.03em] text-[hsl(var(--reservation-ink))]';
  const labelClass =
    'block text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-soft))]';

  return (
    <div style={widgetStyle} className="space-y-5">
      {/* Stepper — progress bar style comme le widget résa */}
      <div className="flex items-center gap-1.5">
        {visibleSteps.map((s, idx) => {
          const realIdx = stepOrder.indexOf(s);
          const isActive = realIdx === currentIdx;
          const isDone = realIdx < currentIdx;
          return (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                isActive
                  ? 'bg-[hsl(var(--reservation-ink))]'
                  : isDone
                    ? 'bg-[hsl(var(--reservation-ink))]'
                    : 'bg-[hsl(var(--reservation-line))]'
              }`}
            />
          );
        })}
      </div>

      {/* Error — style Sokar avec icône Lucide */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200/80 bg-red-50/80 p-4 backdrop-blur-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-[13px] font-medium leading-snug text-red-700">{error}</p>
        </div>
      )}

      {/* ── Étape 1 : Type ── */}
      {step === 'type' && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
              Étape 1
            </p>
            <h2 className={headingClass}>Choisissez le type de carte</h2>
          </div>

          <div className="space-y-2.5">
            {/* Montant libre */}
            <button
              type="button"
              onClick={() => setMode('free')}
              className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
                mode === 'free'
                  ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                  : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                    mode === 'free'
                      ? 'bg-[hsl(var(--reservation-ink))] text-white'
                      : 'bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-soft))]'
                  }`}
                >
                  <Gift size={20} />
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                    Montant libre
                  </p>
                  <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                    Choisissez le montant de votre choix
                  </p>
                </div>
              </div>
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                  mode === 'free'
                    ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                    : 'border-[hsl(var(--reservation-line))]'
                }`}
              >
                {mode === 'free' && <Check size={14} strokeWidth={3} />}
              </div>
            </button>

            {/* Pack expérience */}
            <button
              type="button"
              onClick={() => packs.length > 0 && setMode('pack')}
              disabled={packsLoading || packs.length === 0}
              className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] disabled:opacity-50 ${
                mode === 'pack'
                  ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                  : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                    mode === 'pack'
                      ? 'bg-[hsl(var(--reservation-ink))] text-white'
                      : 'bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-soft))]'
                  }`}
                >
                  <Sparkles size={20} />
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                    Pack expérience
                  </p>
                  <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                    {packsLoading
                      ? 'Chargement...'
                      : packs.length === 0
                        ? 'Aucun pack disponible'
                        : `${packs.length} pack${packs.length > 1 ? 's' : ''} disponible${packs.length > 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                  mode === 'pack'
                    ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                    : 'border-[hsl(var(--reservation-line))]'
                }`}
              >
                {mode === 'pack' && <Check size={14} strokeWidth={3} />}
              </div>
            </button>

            {/* Cagnotte collective */}
            <button
              type="button"
              onClick={() => setMode('crowdfunding')}
              className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
                mode === 'crowdfunding'
                  ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                  : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                    mode === 'crowdfunding'
                      ? 'bg-[hsl(var(--reservation-ink))] text-white'
                      : 'bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-soft))]'
                  }`}
                >
                  <Users size={20} />
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                    Cagnotte collective
                  </p>
                  <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                    Plusieurs personnes contribuent à une carte cadeau
                  </p>
                </div>
              </div>
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                  mode === 'crowdfunding'
                    ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                    : 'border-[hsl(var(--reservation-line))]'
                }`}
              >
                {mode === 'crowdfunding' && <Check size={14} strokeWidth={3} />}
              </div>
            </button>
          </div>

          {/* Montant libre — input */}
          {mode === 'free' && (
            <div className={panelClass}>
              <label className={labelClass}>Montant (€)</label>
              <div className="relative mt-2">
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputClass}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-[hsl(var(--reservation-muted))]">
                  €
                </span>
              </div>
              {/* Quick amounts */}
              <div className="mt-3 flex gap-2">
                {['25', '50', '100', '200'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className={`flex-1 rounded-full py-2 text-[13px] font-bold transition-all duration-200 active:scale-[0.97] ${
                      amount === preset
                        ? 'bg-[hsl(var(--reservation-ink))] text-white'
                        : 'border border-[hsl(var(--reservation-line))] bg-white/60 text-[hsl(var(--reservation-soft))] hover:bg-white'
                    }`}
                  >
                    {preset}€
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pack sélection — liste */}
          {mode === 'pack' && packs.length > 0 && (
            <div className="space-y-2.5">
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setPackId(pack.id)}
                  className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
                    packId === pack.id
                      ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                      : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                      {pack.name}
                    </p>
                    {pack.description && (
                      <p className="mt-0.5 text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                        {pack.description}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] font-medium text-[hsl(var(--reservation-muted))]">
                      {pack.minPartySize === pack.maxPartySize
                        ? `${pack.minPartySize} pers.`
                        : `${pack.minPartySize}–${pack.maxPartySize} pers.`}
                    </p>
                  </div>
                  <p className="ml-3 shrink-0 font-display text-[1.25rem] font-black tracking-tight text-[hsl(var(--reservation-blue))]">
                    {formatEuro(pack.amount)}
                  </p>
                </button>
              ))}
            </div>
          )}

          {mode !== 'crowdfunding' && (
            <button
              type="button"
              onClick={handleNextFromType}
              disabled={packsLoading}
              className={primaryBtnClass}
            >
              Continuer
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <ChevronRight size={17} />
              </span>
            </button>
          )}
        </div>
      )}

      {/* Étape Cagnotte — formulaire de création */}
      {step === 'type' && mode === 'crowdfunding' && (
        <GiftCardCrowdfundingCreate
          slug={slug}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          primaryColor={primaryColor}
          accentColor={accentColor}
          source={source}
        />
      )}

      {/* ── Étape 2 : Informations ── */}
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

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
              Étape 2
            </p>
            <h2 className={headingClass}>Informations</h2>
          </div>

          <div>
            <label className={labelClass}>Occasion (optionnel)</label>
            <input
              type="text"
              placeholder="Anniversaire, remerciement..."
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              className={`${inputClass} mt-2`}
            />
          </div>

          {/* Expéditeur */}
          <div className={panelClass}>
            <div className="mb-3 flex items-center gap-2">
              <Heart size={16} className="text-[hsl(var(--reservation-blue))]" />
              <p className="text-[13px] font-bold text-[hsl(var(--reservation-ink))]">Expéditeur</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Nom"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className={inputClass}
              />
              <input
                type="email"
                placeholder="Email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className={inputClass}
              />
              <input
                type="tel"
                placeholder="Téléphone"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Destinataire */}
          <div className={panelClass}>
            <div className="mb-3 flex items-center gap-2">
              <Gift size={16} className="text-[hsl(var(--reservation-blue))]" />
              <p className="text-[13px] font-bold text-[hsl(var(--reservation-ink))]">
                Destinataire
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Nom"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className={inputClass}
              />
              <input
                type="email"
                placeholder="Email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className={inputClass}
              />
              <input
                type="tel"
                placeholder="Téléphone"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Message personnalisé (optionnel)</label>
            <textarea
              placeholder="Joyeux anniversaire !"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className={`${inputClass} mt-2 resize-none`}
            />
          </div>

          {/* Book now toggle */}
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-[1.1rem] border p-4 transition-all duration-200 ${
              bookNow
                ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
            }`}
          >
            <input
              type="checkbox"
              checked={bookNow}
              onChange={(e) => setBookNow(e.target.checked)}
              className="h-5 w-5 rounded accent-[hsl(var(--reservation-ink))]"
            />
            <div>
              <p className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
                Proposer directement des créneaux au destinataire
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-[hsl(var(--reservation-soft))]">
                Le destinataire verra 3 créneaux et pourra réserver en un clic.
              </p>
            </div>
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('type')}
              className={`${secondaryBtnClass} w-auto px-5`}
            >
              <ChevronLeft size={18} />
              Retour
            </button>
            <button type="button" onClick={handleNextFromInfo} className={primaryBtnClass}>
              Continuer
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <ChevronRight size={17} />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Créneaux (optionnel) ── */}
      {step === 'slots' && bookNow && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
              Étape 3
            </p>
            <h2 className={headingClass}>Préférences de réservation</h2>
          </div>
          <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
            Ces informations aideront à proposer les meilleurs créneaux au destinataire.
          </p>

          <div className={panelClass}>
            <label className={labelClass}>
              <Calendar size={12} className="mr-1 inline" />
              Date préférée
            </label>
            <input
              type="date"
              min={todayIso()}
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className={`${inputClass} mt-2`}
            />
          </div>

          <div className={panelClass}>
            <label className={labelClass}>
              <Users size={12} className="mr-1 inline" />
              Nombre de personnes
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={preferredPartySize}
              onChange={(e) => setPreferredPartySize(e.target.value)}
              className={`${inputClass} mt-2`}
            />
          </div>

          <div className={panelClass}>
            <label className={labelClass}>
              <Clock size={12} className="mr-1 inline" />
              Heure préférée (optionnel)
            </label>
            <input
              type="time"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
              className={`${inputClass} mt-2`}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('info')}
              className={`${secondaryBtnClass} w-auto px-5`}
            >
              <ChevronLeft size={18} />
              Retour
            </button>
            <button type="button" onClick={handleNextFromSlots} className={primaryBtnClass}>
              Continuer
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <ChevronRight size={17} />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Étape 4 : Design / Template ── */}
      {step === 'template' && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
              Étape {bookNow ? '4' : '3'}
            </p>
            <h2 className={headingClass}>Personnalisez votre carte</h2>
          </div>

          <GiftCardTemplatePicker
            selectedTemplate={templateId}
            onSelect={(id) => {
              setTemplateId(id);
              if (id === 'custom') {
                // L'URL personnalisée est gérée dans le picker
              }
            }}
            primaryColor={primaryColor}
            accentColor={accentColor}
          />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(bookNow ? 'slots' : 'info')}
              className={`${secondaryBtnClass} w-auto px-5`}
            >
              <ChevronLeft size={18} />
              Retour
            </button>
            <button type="button" onClick={handleNextFromTemplate} className={primaryBtnClass}>
              Continuer
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <ChevronRight size={17} />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Étape 5 : Paiement ── */}
      {step === 'payment' && (
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
