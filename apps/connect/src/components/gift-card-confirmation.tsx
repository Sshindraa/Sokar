'use client';

/**
 * Sokar Connect — GiftCardConfirmation.
 *
 * Écran de confirmation affiché après l'achat d'une carte cadeau.
 * Affiche le code complet (non masqué) car c'est le bénéficiaire qui le voit.
 * Si l'option "réserver maintenant" était activée, affiche le slots picker.
 */

import { useEffect, useState } from 'react';
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

export function GiftCardConfirmation({
  result,
  restaurantName,
  bookNow,
  primaryColor = '#0F172A',
  accentColor = '#EA580C',
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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-cream p-6">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: accentColor }}
          >
            ✓
          </div>
          <h2 className="text-xl font-semibold" style={{ color: primaryColor }}>
            Carte cadeau créée
          </h2>
        </div>

        <p style={{ color: primaryColor }}>
          Votre carte cadeau chez <strong>{restaurantName}</strong> a été créée avec succès.
        </p>

        <div className="mt-4 rounded-lg border border-border bg-background p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Code de la carte cadeau
          </p>
          <p
            className="mt-1 font-mono text-2xl font-bold tracking-wider"
            style={{ color: accentColor }}
          >
            {result.shortCode ?? result.code}
          </p>
          {result.shortCode && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              Référence : {result.code}
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Montant</p>
            <p className="font-semibold" style={{ color: primaryColor }}>
              {formatEuro(result.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Solde restant</p>
            <p className="font-semibold" style={{ color: primaryColor }}>
              {formatEuro(result.remainingAmount)}
            </p>
          </div>
          {result.packName && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Pack</p>
              <p className="font-medium" style={{ color: primaryColor }}>
                {result.packName}
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Notez ce code précieusement. Il sera demandé pour utiliser la carte cadeau lors de la
          réservation.
        </p>

        {result.pdfUrl && (
          <a
            href={result.pdfUrl}
            target="_parent"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90"
            style={{ backgroundColor: accentColor }}
          >
            📄 Télécharger la carte cadeau (PDF)
          </a>
        )}

        {!bookNow && (
          <p className="mt-3 text-sm text-muted-foreground">
            Le destinataire pourra réserver sa table quand il le souhaite en utilisant ce code sur
            la page de réservation.
          </p>
        )}
      </div>

      {bookNow && (
        <div>
          {loadingSlots ? (
            <div className="rounded-xl border border-border bg-cream p-6 text-center">
              <p className="text-sm text-muted-foreground">Chargement des créneaux...</p>
            </div>
          ) : slotsError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {slotsError}
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

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}
