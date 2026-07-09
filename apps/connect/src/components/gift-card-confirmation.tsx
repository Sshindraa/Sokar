'use client';

/**
 * Sokar Connect — GiftCardConfirmation.
 *
 * Écran de confirmation affiché après l'achat d'une carte cadeau.
 * Affiche le code complet (non masqué) car c'est le bénéficiaire qui le voit.
 * Si l'option "réserver maintenant" était activée, affiche le slots picker.
 *
 * Design aligné avec le widget de réservation Sokar.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Download, PartyPopper, Calendar } from 'lucide-react';
import { formatEuro } from '@sokar/shared';
import type { GiftCardPurchaseResult, GiftCardSlot } from '@/lib/api/gift-cards';
import { suggestGiftCardSlots } from '@/lib/api/gift-cards';
import { GiftCardSlotsPicker } from './gift-card-slots-picker';

type Props = {
  result: GiftCardPurchaseResult;
  restaurantName: string;
  bookNow: boolean;
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
  '--reservation-success': '142 70% 38%',
};

export function GiftCardConfirmation({
  result,
  restaurantName,
  bookNow,
  primaryColor = '#0F172A',
  accentColor = '#0284C7',
}: Props) {
  const [slots, setSlots] = useState<GiftCardSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookNow) return;
    setLoadingSlots(true);
    setSlotsError(null);
    const publicCode = result.shortCode ?? result.code;
    suggestGiftCardSlots(publicCode, {
      preferredDate: result.preferredDate ?? undefined,
      preferredTime: result.preferredTime ?? undefined,
      partySize: result.preferredPartySize ?? undefined,
    })
      .then((data) => setSlots(data.slots))
      .catch((err) => setSlotsError(err.message || 'Impossible de charger les créneaux'))
      .finally(() => setLoadingSlots(false));
  }, [
    bookNow,
    result.code,
    result.shortCode,
    result.preferredDate,
    result.preferredTime,
    result.preferredPartySize,
  ]);

  const panelClass =
    'rounded-[1.5rem] border border-white/70 bg-white/60 p-6 backdrop-blur-2xl shadow-sm';

  return (
    <div style={reservationTheme} className="space-y-5">
      {/* Carte de confirmation — glassmorphism */}
      <div className={panelClass}>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--reservation-ink))] text-white shadow-lg shadow-black/10">
            <Check size={24} strokeWidth={3} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
              Confirmation
            </p>
            <h2 className="font-display text-[1.5rem] font-black leading-tight tracking-[-0.03em] text-[hsl(var(--reservation-ink))]">
              Carte cadeau créée
            </h2>
          </div>
        </div>

        <p className="text-[15px] font-medium text-[hsl(var(--reservation-ink))]">
          Votre carte cadeau chez <strong>{restaurantName}</strong> a été créée avec succès.
        </p>

        {/* Code — display prominent */}
        <div className="mt-4 rounded-2xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-wash))] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-soft))]">
            Code de la carte cadeau
          </p>
          <p className="mt-1.5 font-display text-[1.75rem] font-black tracking-wider text-[hsl(var(--reservation-blue))]">
            {result.shortCode ?? result.code}
          </p>
          {result.shortCode && (
            <p className="mt-1 font-mono text-[10px] text-[hsl(var(--reservation-muted))]">
              Référence : {result.code}
            </p>
          )}
        </div>

        {/* Montants — grid */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[hsl(var(--reservation-line))] bg-white/50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
              Montant
            </p>
            <p className="mt-1 font-display text-[1.25rem] font-black text-[hsl(var(--reservation-ink))]">
              {formatEuro(result.amount)}
            </p>
          </div>
          <div className="rounded-xl border border-[hsl(var(--reservation-line))] bg-white/50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
              Solde restant
            </p>
            <p className="mt-1 font-display text-[1.25rem] font-black text-[hsl(var(--reservation-ink))]">
              {formatEuro(result.remainingAmount)}
            </p>
          </div>
          {result.packName && (
            <div className="col-span-2 rounded-xl border border-[hsl(var(--reservation-line))] bg-white/50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
                Pack
              </p>
              <p className="mt-1 text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
                {result.packName}
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 text-[13px] font-medium leading-snug text-[hsl(var(--reservation-soft))]">
          Notez ce code précieusement. Il sera demandé pour utiliser la carte cadeau lors de la
          réservation.
        </p>

        {/* PDF download — bouton Sokar style */}
        {result.pdfUrl && (
          <a
            href={result.pdfUrl}
            target="_parent"
            rel="noopener noreferrer"
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[16px] font-extrabold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <Download size={18} />
            Télécharger la carte cadeau (PDF)
          </a>
        )}

        {!bookNow && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-wash))] p-3">
            <PartyPopper
              size={16}
              className="mt-0.5 shrink-0 text-[hsl(var(--reservation-blue))]"
            />
            <p className="text-[13px] font-medium leading-snug text-[hsl(var(--reservation-soft))]">
              Le destinataire pourra réserver sa table quand il le souhaite en utilisant ce code sur
              la page de réservation.
            </p>
          </div>
        )}
      </div>

      {/* Slots picker — si bookNow */}
      {bookNow && (
        <div>
          {loadingSlots ? (
            <div className={`${panelClass} text-center`}>
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--reservation-ink))]">
                  <Calendar size={20} className="animate-pulse text-white" />
                </div>
                <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                  Chargement des créneaux...
                </p>
              </div>
            </div>
          ) : slotsError ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-red-200/80 bg-red-50/80 p-4 backdrop-blur-sm">
              <p className="text-[13px] font-medium text-red-700">{slotsError}</p>
            </div>
          ) : (
            <GiftCardSlotsPicker
              code={result.shortCode ?? result.code}
              slots={slots}
              primaryColor={primaryColor}
              accentColor={accentColor}
            />
          )}
        </div>
      )}
    </div>
  );
}
