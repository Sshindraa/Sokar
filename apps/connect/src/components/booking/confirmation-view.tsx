/**
 * Sokar Connect — ConfirmationView.
 *
 * Écran de confirmation affiché après une réservation réussie.
 */

import Link from 'next/link';

export type ConfirmDto = {
  reservationId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  source?: string;
};

export function ConfirmationView({ result, slug }: { result: ConfirmDto; slug: string }) {
  return (
    <div className="rounded-xl border border-border bg-cream p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ember text-white">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-ink">Réservation confirmée</h2>
      </div>
      <p className="text-ink">
        Votre table chez <strong>{result.restaurantName}</strong> est réservée pour{' '}
        <strong>
          {result.partySize} personne{result.partySize > 1 ? 's' : ''}
        </strong>{' '}
        le <strong>{result.date}</strong> à <strong>{result.time}</strong>.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Code de réservation :{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{result.reservationId}</code>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Un SMS de confirmation vous a été envoyé.
      </p>
      <Link
        href={`/restaurant/${slug}`}
        className="mt-6 inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-2 text-sm font-semibold text-ink transition-all duration-200 hover:bg-muted"
      >
        ← Retour à la fiche
      </Link>
    </div>
  );
}
