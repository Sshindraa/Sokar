'use client';

/**
 * Sokar Connect — GiftCardCrowdfundingCreate.
 *
 * Formulaire de création d'une cagnotte pour carte cadeau.
 * Le créateur définit : titre, occasion, destinataire, date butoir,
 * montant cible (optionnel), message.
 */

import { useState } from 'react';
import type { CreateCrowdfundingResult } from '@/lib/api/gift-cards';
import { createCrowdfunding } from '@/lib/api/gift-cards';
import { GiftCardTemplatePicker } from './gift-card-template-picker';
import { trackEvent } from '@/lib/tracking';

type Props = {
  slug: string;
  restaurantId: string;
  restaurantName: string;
  primaryColor?: string;
  accentColor?: string;
  source?: string;
};

export function GiftCardCrowdfundingCreate({
  slug,
  restaurantId,
  restaurantName,
  primaryColor = '#0F172A',
  accentColor = '#EA580C',
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
    } catch (err: any) {
      setError(err.message || 'Impossible de créer la cagnotte. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const contributionUrl = `${shareUrl}?crowdfund=${result.code}`;
    return (
      <div className="space-y-4">
        <div
          className="rounded-xl border p-6 text-center"
          style={{ borderColor: `${accentColor}40`, backgroundColor: `${accentColor}08` }}
        >
          <div className="text-3xl">🎉</div>
          <h2 className="mt-2 text-lg font-semibold" style={{ color: primaryColor }}>
            Votre cagnotte est créée !
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Partagez ce lien avec les participants pour qu&apos;ils contribuent :
          </p>
          <div
            className="mt-3 rounded-lg border border-border bg-background p-3 font-mono text-sm break-all"
            style={{ color: accentColor }}
          >
            {contributionUrl}
          </div>
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(contributionUrl);
              }
            }}
            className="mt-3 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90"
            style={{ backgroundColor: accentColor }}
          >
            Copier le lien
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: primaryColor }}>
        Créer une cagnotte
      </h2>
      <p className="text-sm text-muted-foreground">
        Lancez une cagnotte pour offrir une carte cadeau collective à {restaurantName}. Chaque
        participant contribue librement, et vous décidez quand clôturer.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium" style={{ color: primaryColor }}>
            Titre de la cagnotte *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Cagnotte anniversaire Marie"
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium" style={{ color: primaryColor }}>
            Occasion
          </label>
          <input
            type="text"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="Ex : Anniversaire, départ à la retraite..."
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium" style={{ color: primaryColor }}>
              Nom du destinataire *
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Ex : Marie"
              maxLength={100}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: primaryColor }}>
              Email du destinataire
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="marie@example.com"
              maxLength={255}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium" style={{ color: primaryColor }}>
            Téléphone du destinataire
          </label>
          <input
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="+33612345678"
            maxLength={50}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium" style={{ color: primaryColor }}>
              Votre nom *
            </label>
            <input
              type="text"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="Ex : Jean"
              maxLength={100}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: primaryColor }}>
              Votre email *
            </label>
            <input
              type="email"
              value={creatorEmail}
              onChange={(e) => setCreatorEmail(e.target.value)}
              placeholder="jean@example.com"
              maxLength={255}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium" style={{ color: primaryColor }}>
              Montant cible (€)
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              placeholder="Optionnel"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: primaryColor }}>
              Date butoir *
            </label>
            <input
              type="date"
              value={crowdfundedUntil}
              onChange={(e) => setCrowdfundedUntil(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
              required
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium" style={{ color: primaryColor }}>
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Un mot pour accompagner la cagnotte..."
            maxLength={1000}
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex w-full items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: accentColor }}
      >
        {loading ? 'Création...' : 'Créer la cagnotte'}
      </button>
    </form>
  );
}
