'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import styles from './reservation-view.module.css';

type Booking = {
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  state: string;
  modification?: { available: boolean; message: string };
};
class ReservationRequestError extends Error {}

type Slot = { time: string; proposalToken: string };
type Options = {
  date: string;
  partySize: number;
  maxPartySize: number;
  slots: Slot[];
  message: string;
};

export function ReservationModification<T extends Booking>({
  booking,
  token,
  disabled,
  terms,
  onUpdated,
}: {
  booking: T;
  token: string;
  disabled: boolean;
  terms?: string;
  onUpdated: (booking: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [partySize, setPartySize] = useState(booking.partySize);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [review, setReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const inFlight = useRef(false);

  async function request<R>(body: Record<string, unknown>): Promise<R> {
    const response = await fetch('/api/reservation-management', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...body }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new ReservationRequestError(
        typeof data.error === 'string' ? data.error : 'La demande n’a pas pu être confirmée.',
      );
    return data as R;
  }
  async function load(count: number, refreshBooking = false) {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    setSelected(null);
    setReview(false);
    setOptions((previous) =>
      previous ? { ...previous, partySize: count, slots: [], message: '' } : null,
    );
    try {
      if (refreshBooking) {
        const fresh = await request<T>({ action: 'view' });
        if (current !== sequence.current) return;
        onUpdated(fresh);
        if (!fresh.modification?.available) {
          setError(fresh.modification?.message ?? 'Veuillez contacter le restaurant.');
          return;
        }
      }
      const result = await request<Options>({ action: 'modification_options', partySize: count });
      if (current === sequence.current) setOptions(result);
    } catch (e) {
      if (current === sequence.current)
        setError(
          e instanceof ReservationRequestError
            ? e.message
            : 'Les disponibilités ne sont pas accessibles. Vérifiez votre connexion puis réessayez.',
        );
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  function changeOpen(value: boolean) {
    if (inFlight.current) return;
    setOpen(value);
    if (value) {
      setPartySize(booking.partySize);
      void load(booking.partySize, true);
    } else {
      ++sequence.current;
      setOptions(null);
      setSelected(null);
      setError('');
    }
  }
  async function confirm() {
    if (!selected || !options || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    try {
      const updated = await request<T>({
        action: 'modify',
        confirmed: true,
        proposalToken: selected.proposalToken,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (e) {
      try {
        const actual = await request<T>({ action: 'view' });
        onUpdated(actual);
        if (
          actual.date === options.date &&
          actual.time === selected.time &&
          actual.partySize === options.partySize &&
          ['PENDING', 'CONFIRMED'].includes(actual.state)
        ) {
          setOpen(false);
        } else {
          setError(
            e instanceof ReservationRequestError
              ? e.message
              : 'La modification n’a pas pu être confirmée. Consultez les disponibilités à nouveau.',
          );
          setOptions(null);
          setSelected(null);
          setReview(false);
        }
      } catch {
        setOptions(null);
        setSelected(null);
        setReview(false);
        setError(
          'Impossible de vérifier le résultat. Fermez cette fenêtre puis rouvrez-la pour relire votre réservation.',
        );
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${booking.date}T12:00:00Z`),
  );
  return (
    <>
      <Button
        variant="link"
        disabled={disabled}
        onClick={() => changeOpen(true)}
        className="min-h-11 px-0 transition-all duration-200"
      >
        Modifier la réservation
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          showCloseButton={!submitting}
          className={cn(styles.page, 'max-w-md bg-background text-foreground')}
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {review ? 'Confirmer ce changement ?' : 'Modifier la réservation'}
            </DialogTitle>
            <DialogDescription>
              {booking.restaurantName} · {dateLabel}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Réservation actuelle : {booking.time} · {booking.partySize}{' '}
            {booking.partySize === 1 ? 'personne' : 'personnes'}.
          </p>
          {loading && !options ? (
            <p role="status" className="text-sm">
              Recherche des disponibilités…
            </p>
          ) : review && selected && options ? (
            <div className="space-y-3 text-sm">
              <p>
                Nouveau choix :{' '}
                <strong>
                  {selected.time} · {options.partySize}{' '}
                  {options.partySize === 1 ? 'personne' : 'personnes'}
                </strong>
                .
              </p>
              {terms && <p className="text-muted-foreground">{terms}</p>}
              <p>
                Votre réservation actuelle sera remplacée uniquement après confirmation du nouveau
                choix.
              </p>
            </div>
          ) : options ? (
            <div className="space-y-4">
              <label className="block space-y-2 text-sm">
                <span>Nombre de personnes</span>
                <select
                  value={partySize}
                  onChange={(event) => {
                    const count = Number(event.target.value);
                    setPartySize(count);
                    void load(count);
                  }}
                  className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {partySize > options.maxPartySize && (
                    <option value={partySize}>{partySize} (actuel)</option>
                  )}
                  {Array.from({ length: options.maxPartySize }, (_, index) => index + 1).map(
                    (count) => (
                      <option key={count} value={count}>
                        {count} {count === 1 ? 'personne' : 'personnes'}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <fieldset>
                <legend className="mb-2 text-sm">Heures disponibles</legend>
                {loading && (
                  <p role="status" className="mb-2 text-sm">
                    Recherche des disponibilités…
                  </p>
                )}
                <div
                  className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto p-1"
                  role="radiogroup"
                  aria-label="Heures disponibles"
                >
                  {options.slots.map((slot) => (
                    <label key={slot.time} className="relative block cursor-pointer">
                      <input
                        type="radio"
                        name="reservation-time"
                        value={slot.time}
                        checked={selected?.time === slot.time}
                        onChange={() => setSelected(slot)}
                        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      />
                      <span className="flex min-h-11 items-center justify-center rounded-md border border-border text-sm transition-all duration-200 peer-checked:border-foreground peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                        {slot.time}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-muted-foreground">{options.message}</p>
            </div>
          ) : null}
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => (review ? setReview(false) : changeOpen(false))}
              className="transition-all duration-200"
            >
              {review ? 'Revenir aux choix' : 'Conserver ma réservation'}
            </Button>
            {!loading && !options && (
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => void load(partySize, true)}
                className="transition-all duration-200"
              >
                Actualiser les disponibilités
              </Button>
            )}
            {review ? (
              <Button
                disabled={submitting || !selected}
                onClick={() => void confirm()}
                className="transition-all duration-200"
              >
                {submitting ? 'Modification en cours…' : 'Confirmer la modification'}
              </Button>
            ) : options ? (
              <Button
                disabled={!selected || loading}
                onClick={() => setReview(true)}
                className="transition-all duration-200"
              >
                Vérifier ce changement
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
