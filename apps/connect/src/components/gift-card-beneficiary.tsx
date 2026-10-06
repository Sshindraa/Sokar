'use client';
import { GiftCardTestBanner } from './gift-card-test-banner';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatEuro } from '@sokar/shared';
import { getGiftCardBeneficiary, type GiftCardBeneficiary } from '@/lib/api/gift-cards';

export function GiftCardBeneficiaryPage({ code }: { code: string }) {
  const [card, setCard] = useState<GiftCardBeneficiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCard(await getGiftCardBeneficiary(code));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Carte cadeau indisponible');
    } finally {
      setLoading(false);
    }
  }, [code]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <main className="mx-auto min-h-screen max-w-xl space-y-6 p-6 sm:p-8">
      <GiftCardTestBanner />
      <h1 className="text-2xl font-semibold">Votre carte cadeau</h1>
      {loading ? (
        <p role="status">Chargement de votre solde…</p>
      ) : error ? (
        <div role="alert" className="space-y-3">
          <p>{error}</p>
          <button
            onClick={refresh}
            className="rounded-lg border border-border px-4 py-2 transition-all duration-200"
          >
            Réessayer
          </button>
        </div>
      ) : (
        card && (
          <>
            <div className="space-y-3 rounded-xl border border-border bg-card p-6">
              <h2 className="text-xl font-semibold">{card.restaurantName}</h2>
              {card.packName && <p>{card.packName}</p>}
              <p>Solde disponible</p>
              <p className="text-3xl font-bold">{formatEuro(card.remainingAmount)}</p>
              <p>
                Code : <strong>{card.displayCode}</strong>
              </p>
              {card.expiresAt && (
                <p className="text-sm text-muted-foreground">
                  Valable jusqu’au {new Date(card.expiresAt).toLocaleDateString('fr-FR')}
                </p>
              )}
              {!card.usable && (
                <p role="status">
                  Cette carte ne peut pas être utilisée actuellement. Contactez le restaurant pour
                  vérifier sa situation.
                </p>
              )}
            </div>
            <p>
              Votre réservation associe la carte sans débiter son solde. Présentez votre code au
              restaurant : le montant réellement utilisé sera déduit de votre addition, avec un
              complément à régler si nécessaire.
            </p>
            {card.usable && card.restaurantSlug && (
              <Link
                href={`/widget/${encodeURIComponent(card.restaurantSlug)}?giftCardCode=${encodeURIComponent(card.displayCode)}`}
                className="inline-flex rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90"
              >
                Réserver une table
              </Link>
            )}
            <button
              onClick={refresh}
              className="block rounded-lg border border-border px-4 py-2 transition-all duration-200"
            >
              Actualiser le solde
            </button>
          </>
        )
      )}
    </main>
  );
}
