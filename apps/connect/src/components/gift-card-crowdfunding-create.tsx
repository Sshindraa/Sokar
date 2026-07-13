'use client';

/**
 * Sokar Connect — GiftCardCrowdfundingCreate.
 *
 * Formulaire de création d'une cagnotte pour carte cadeau.
 * Le créateur définit : titre, occasion, destinataire, date butoir,
 * montant cible (optionnel), message.
 *
 * Design aligné avec le widget de réservation Sokar.
 */

import { useState, type CSSProperties } from 'react';
import { PartyPopper, AlertCircle, Loader2, Copy } from 'lucide-react';
import type { CreateCrowdfundingResult } from '@/lib/api/gift-cards';
import { createCrowdfunding } from '@/lib/api/gift-cards';
import { GiftCardTemplatePicker } from './gift-card-template-picker';
import { trackEvent } from '@/lib/tracking';
import { GIFT_CARD_MESSAGE_MAX_LENGTH } from '@/lib/constants/gift-cards';

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
  '--reservation-blue': '207 92% 52%',
};

export function GiftCardCrowdfundingCreate({
  slug,
  restaurantId,
  restaurantName,
  primaryColor = '#0F172A',
  accentColor = '#0284C7',
  source = 'widget',
}: Props) {
  const [title, setTitle] = useState('');
  const [occasion, setOccasion] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [creatorEmail, setCreatorEmail] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [crowdfundedUntil, setCrowdfundedUntil] = useState('');
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateCrowdfundingResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title || !recipientName || !creatorName || !creatorEmail || !crowdfundedUntil) {
      setError('Veuillez remplir tous les champs obligatoires');
      return;
    }

    const until = new Date(crowdfundedUntil);
    if (until <= new Date()) {
      setError('La date butoir doit être dans le futur');
      return;
    }

    setLoading(true);

    trackEvent({
      event: 'crowdfunding_create_started',
      restaurantId,
      restaurantSlug: slug,
      source,
    });

    try {
      const res = await createCrowdfunding({
        restaurantId,
        title,
        occasion: occasion || undefined,
        recipientName,
        recipientEmail: recipientEmail || undefined,
        recipientPhone: recipientPhone || undefined,
        creatorName,
        creatorEmail,
        targetAmount: targetAmount ? parseFloat(targetAmount) : undefined,
        crowdfundedUntil: until.toISOString(),
        templateId: templateId ?? undefined,
        message: message || undefined,
      });

      setResult(res);

      trackEvent({
        event: 'crowdfunding_create_completed',
        restaurantId,
        restaurantSlug: slug,
        code: res.code,
        source,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de créer la cagnotte. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  const panelClass =
    'rounded-[1.5rem] border border-white/70 bg-white/60 p-6 backdrop-blur-2xl shadow-sm';
  const inputClass =
    'w-full rounded-xl border border-[hsl(var(--reservation-line))] bg-white/70 px-4 py-3 text-[15px] font-medium text-[hsl(var(--reservation-ink))] placeholder:text-[hsl(var(--reservation-muted))] transition-all duration-200 focus:border-white/80 focus:bg-white/62 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';
  const labelClass =
    'block text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-soft))]';
  const headingClass =
    'font-display text-[1.5rem] font-black leading-tight tracking-[-0.03em] text-[hsl(var(--reservation-ink))]';

  if (result) {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const contributionUrl = `${shareUrl}?crowdfund=${result.code}`;
    return (
      <div style={reservationTheme} className="space-y-4">
        <div className={`${panelClass} text-center`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--reservation-ink))] text-white shadow-lg shadow-black/10">
            <PartyPopper size={24} />
          </div>
          <h2 className={headingClass}>Votre cagnotte est créée !</h2>
          <p className="mt-2 text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
            Partagez ce lien avec les participants pour qu&apos;ils contribuent :
          </p>
          <div className="mt-3 rounded-xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-wash))] p-3 font-mono text-[13px] font-bold break-all text-[hsl(var(--reservation-blue))]">
            {contributionUrl}
          </div>
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(contributionUrl);
              }
            }}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[14px] font-bold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <Copy size={16} />
            Copier le lien
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={reservationTheme} className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
          Cagnotte collective
        </p>
        <h2 className={headingClass}>Créer une cagnotte</h2>
      </div>
      <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
        Lancez une cagnotte pour offrir une carte cadeau collective à {restaurantName}. Chaque
        participant contribue librement, et vous décidez quand clôturer.
      </p>

      <div className="space-y-4">
        <div>
          <label className={labelClass}>Titre de la cagnotte *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Cagnotte anniversaire Marie"
            maxLength={200}
            className={`${inputClass} mt-2`}
            required
          />
        </div>

        <div>
          <label className={labelClass}>Occasion</label>
          <input
            type="text"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="Ex : Anniversaire, départ à la retraite..."
            maxLength={100}
            className={`${inputClass} mt-2`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Nom du destinataire *</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Ex : Marie"
              maxLength={100}
              className={`${inputClass} mt-2`}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Email du destinataire</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="marie@example.com"
              maxLength={255}
              className={`${inputClass} mt-2`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Téléphone du destinataire</label>
          <input
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="+33612345678"
            maxLength={50}
            className={`${inputClass} mt-2`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Votre nom *</label>
            <input
              type="text"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="Ex : Jean"
              maxLength={100}
              className={`${inputClass} mt-2`}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Votre email *</label>
            <input
              type="email"
              value={creatorEmail}
              onChange={(e) => setCreatorEmail(e.target.value)}
              placeholder="jean@example.com"
              maxLength={255}
              className={`${inputClass} mt-2`}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Montant cible (€)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              placeholder="Optionnel"
              className={`${inputClass} mt-2`}
            />
          </div>
          <div>
            <label className={labelClass}>Date butoir *</label>
            <input
              type="date"
              value={crowdfundedUntil}
              onChange={(e) => setCrowdfundedUntil(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className={`${inputClass} mt-2`}
              required
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Un mot pour accompagner la cagnotte..."
            maxLength={GIFT_CARD_MESSAGE_MAX_LENGTH}
            rows={3}
            className={`${inputClass} mt-2 resize-none`}
          />
        </div>

        <GiftCardTemplatePicker
          selectedTemplate={templateId}
          onSelect={setTemplateId}
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200/80 bg-red-50/80 p-4 backdrop-blur-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-[13px] font-medium leading-snug text-red-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[17px] font-extrabold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Création...
          </>
        ) : (
          'Créer la cagnotte'
        )}
      </button>
    </form>
  );
}
