'use client';

import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Ce que la section lit d'un restaurant : aucune donnée du gérant. */
export interface PendingNumberCandidate {
  restaurantId: string;
  restaurantName: string;
  city: string | null;
  hasAssignedPhone: boolean;
  floorCompletedAt: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Les restaurants dont la salle est terminée et qui n'ont pas de numéro Sokar utilisable, le plus
 * ancien en premier : ce sont eux qui sont bloqués hors de leur espace.
 */
export function restaurantsAwaitingNumber<T extends PendingNumberCandidate>(
  restaurants: T[],
): Array<T & { floorCompletedAt: string }> {
  return restaurants
    .filter(
      (restaurant): restaurant is T & { floorCompletedAt: string } =>
        !restaurant.hasAssignedPhone && Boolean(restaurant.floorCompletedAt),
    )
    .sort(
      (a, b) => new Date(a.floorCompletedAt).getTime() - new Date(b.floorCompletedAt).getTime(),
    );
}

/** « moins d'une minute », « 12 min », « 3 h », « 2 jours ». */
export function formatWaitingTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < MINUTE) return 'moins d’une minute';
  if (milliseconds < HOUR) return `${Math.floor(milliseconds / MINUTE)} min`;
  if (milliseconds < DAY) return `${Math.floor(milliseconds / HOUR)} h`;
  const days = Math.floor(milliseconds / DAY);
  return `${days} ${days > 1 ? 'jours' : 'jour'}`;
}

export function PendingNumbersSection({
  restaurants,
  loading,
  error,
  onSelect,
  onRetry,
  now = Date.now(),
}: {
  restaurants: PendingNumberCandidate[];
  loading: boolean;
  error: string | null;
  onSelect: (restaurantId: string) => void;
  onRetry: () => void;
  /** Injectable pour les tests. */
  now?: number;
}) {
  const waiting = restaurantsAwaitingNumber(restaurants);
  const title =
    !loading && !error ? `En attente de numéro (${waiting.length})` : 'En attente de numéro';

  return (
    <section
      aria-labelledby="pending-numbers-title"
      className="rounded-xl border border-border bg-card shadow-sm transition-all duration-200"
    >
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Clock className="h-4 w-4 text-warning" aria-hidden="true" />
        <h2 id="pending-numbers-title" className="text-base font-semibold text-foreground">
          {title}
        </h2>
      </div>

      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          Chargement des restaurants en attente…
        </div>
      ) : error ? (
        <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Impossible de charger les restaurants en attente de numéro.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="transition-all duration-200"
          >
            Réessayer
          </Button>
        </div>
      ) : waiting.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-5 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
          Aucun restaurant en attente de numéro
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {waiting.map((restaurant) => (
            <li
              key={restaurant.restaurantId}
              className="flex flex-col gap-3 px-5 py-4 transition-all duration-200 hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {restaurant.restaurantName}
                  {restaurant.city && (
                    <span className="font-normal text-muted-foreground"> · {restaurant.city}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Attend depuis{' '}
                  {formatWaitingTime(now - new Date(restaurant.floorCompletedAt).getTime())}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => onSelect(restaurant.restaurantId)}
                aria-label={`Attribuer un numéro à ${restaurant.restaurantName}`}
                className="gap-2 transition-all duration-200"
              >
                Attribuer un numéro
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
