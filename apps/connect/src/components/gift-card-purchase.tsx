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
 * Orchestrator : délègue l'état au hook useGiftCardFlow et le rendu
 * aux sous-composants d'étape dans ./gift-card/.
 *
 * Design aligné avec le widget de réservation Sokar :
 *   - Background cream avec décorations gradient
 *   - Panneaux glassmorphism (backdrop-blur, border-white/70)
 *   - Boutons rounded-full avec hover lift et active scale
 *   - Display font (Outfit) pour les titres, tracking tight
 *   - Icônes Lucide au lieu d'emojis
 *   - Labels uppercase tracking-wide
 */

import { type CSSProperties } from 'react';
import { AlertCircle } from 'lucide-react';
import type { GiftCardPurchaseResult } from '@/lib/api/gift-cards';
import { GiftCardConfirmation } from './gift-card-confirmation';
import { useGiftCardFlow, type GiftCardStep } from './gift-card/use-gift-card-flow';
import { reservationTheme } from './gift-card/shared';
import { GiftCardTypeStep } from './gift-card/GiftCardTypeStep';
import { GiftCardInfoStep } from './gift-card/GiftCardInfoStep';
import { GiftCardSlotsStep } from './gift-card/GiftCardSlotsStep';
import { GiftCardTemplateStep } from './gift-card/GiftCardTemplateStep';
import { GiftCardPaymentStep } from './gift-card/GiftCardPaymentStep';

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
  accentColor = '#0284C7',
  source = 'widget',
}: Props) {
  const flow = useGiftCardFlow({ slug, restaurantId, source });

  const widgetStyle = {
    ...reservationTheme,
    '--widget-primary': primaryColor,
    '--widget-accent': accentColor,
  } as CSSProperties;

  if (flow.step === 'done' && flow.result) {
    return (
      <div style={widgetStyle}>
        <GiftCardConfirmation
          result={flow.result}
          restaurantName={restaurantName}
          bookNow={flow.bookNow}
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      </div>
    );
  }

  const selectedPack = flow.packs.find((p) => p.id === flow.packId);
  const displayAmount =
    flow.mode === 'free' ? parseFloat(flow.amount) || 0 : (selectedPack?.amount ?? 0);

  const stepOrder: GiftCardStep[] = ['type', 'info', 'slots', 'template', 'payment'];
  const currentIdx = stepOrder.indexOf(flow.step);
  const visibleSteps = stepOrder.filter((s) => s !== 'slots' || flow.bookNow);

  return (
    <div style={widgetStyle} className="space-y-5">
      {/* Stepper — progress bar style comme le widget résa */}
      <div className="flex items-center gap-1.5">
        {visibleSteps.map((s) => {
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
      {flow.error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200/80 bg-red-50/80 p-4 backdrop-blur-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-[13px] font-medium leading-snug text-red-700">{flow.error}</p>
        </div>
      )}

      {/* ── Étape 1 : Type ── */}
      {flow.step === 'type' && (
        <GiftCardTypeStep
          flow={flow}
          packs={flow.packs}
          packsLoading={flow.packsLoading}
          slug={slug}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          primaryColor={primaryColor}
          accentColor={accentColor}
          source={source}
        />
      )}

      {/* ── Étape 2 : Informations ── */}
      {flow.step === 'info' && <GiftCardInfoStep flow={flow} />}

      {/* ── Étape 3 : Créneaux (optionnel) ── */}
      {flow.step === 'slots' && flow.bookNow && <GiftCardSlotsStep flow={flow} />}

      {/* ── Étape 4 : Design / Template ── */}
      {flow.step === 'template' && (
        <GiftCardTemplateStep flow={flow} primaryColor={primaryColor} accentColor={accentColor} />
      )}

      {/* ── Étape 5 : Paiement ── */}
      {flow.step === 'payment' && (
        <GiftCardPaymentStep
          flow={flow}
          selectedPack={selectedPack}
          displayAmount={displayAmount}
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      )}
    </div>
  );
}
