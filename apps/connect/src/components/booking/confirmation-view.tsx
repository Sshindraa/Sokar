/**
 * Sokar Connect — ConfirmationView.
 *
 * Écran de confirmation affiché après une réservation réussie.
 */

import Link from 'next/link';
import { Check } from 'lucide-react';

export type ConfirmDto = {
  reservationId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  source?: string;
};

export function ConfirmationView({
  result,
  slug,
  embedded = false,
}: {
  result: ConfirmDto;
  slug: string;
  embedded?: boolean;
}) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-border bg-cream p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--widget-accent)] text-white">
          <Check aria-hidden="true" size={20} />
        </div>
        <h2 className="text-xl font-semibold text-[var(--widget-primary)]">
          Réservation confirmée
        </h2>
      </div>
      <p className="text-[var(--widget-primary)]">
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
      {!embedded && (
        <Link
          href={`/restaurant/${slug}`}
          className="mt-6 inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-2 text-sm font-semibold text-[var(--widget-primary)] transition-all duration-200 hover:bg-muted"
        >
          ← Retour à la fiche
        </Link>
      )}
    </div>
  );
}
