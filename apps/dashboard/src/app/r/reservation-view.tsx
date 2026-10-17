'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Phone,
  Check,
  Loader2,
  MessageCircle,
  CircleDashed,
  CircleX,
  ChevronDown,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SokarLogo } from '@/components/SokarLogo';
import { cn } from '@/lib/utils';
import styles from './reservation-view.module.css';

type Reservation = {
  restaurantName: string;
  restaurantPhone: string | null;
  restaurantAddress?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  date: string;
  time: string;
  partySize: number;
  state: string;
  whatsappReminder: { visible: boolean; enabled: boolean };
};
const STATES: Record<string, string> = {
  CONFIRMED: 'Confirmée',
  PENDING: 'En attente',
  CANCELLED: 'Annulée',
  SEATED: 'Sur place',
  HONORED: 'Terminée',
  NO_SHOW: 'Absence enregistrée',
  EXPIRED: 'Expirée',
  FAILED: 'Non confirmée',
};

export default function ReservationView({ demo = false }: { demo?: boolean }) {
  const token = useRef('');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [withdrawn, setWithdrawn] = useState(false);

  const demoEnabled = useRef(true);
  const request = useCallback(
    async (action: 'view' | 'withdraw_whatsapp') => {
      if (demo) {
        if (action === 'withdraw_whatsapp') demoEnabled.current = false;
        return {
          restaurantName: 'Restaurant Exemple',
          restaurantPhone: null,
          restaurantAddress: '12 rue de la Table, 75002 Paris',
          startsAt: '2026-10-18T17:30:00Z',
          endsAt: null,
          date: '2026-10-18',
          time: '19:30',
          partySize: 2,
          state: 'CONFIRMED',
          whatsappReminder: { visible: true, enabled: demoEnabled.current },
        };
      }
      const response = await fetch('/api/reservation-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.current, action }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'Ce lien est invalide ou a expiré.'
            : 'La demande n’a pas pu être confirmée. Veuillez réessayer.',
        );
      return (await response.json()) as Reservation;
    },
    [demo],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setReservation(null);
    setWithdrawn(false);
    setBusy(false);
    token.current = window.location.hash.slice(1);
    const currentToken = token.current;
    if (!demo && !/^[A-Za-z0-9_-]{27}\.[A-Za-z0-9_-]{43}$/.test(token.current)) {
      setError('Ouvrez le lien personnel reçu avec votre confirmation.');
      setLoading(false);
      return;
    }
    try {
      const current = await request('view');
      if (currentToken === token.current) setReservation(current);
    } catch (e) {
      if (currentToken === token.current)
        setError(e instanceof Error ? e.message : 'Service indisponible.');
    } finally {
      if (currentToken === token.current) setLoading(false);
    }
  }, [request, demo]);

  useEffect(() => {
    void load();
    window.addEventListener('hashchange', load);
    return () => window.removeEventListener('hashchange', load);
  }, [load]);

  async function withdraw() {
    if (!reservation?.whatsappReminder.enabled || busy) return;
    setBusy(true);
    setError('');
    const currentToken = token.current;
    try {
      const current = await request('withdraw_whatsapp');
      if (currentToken === token.current) {
        setReservation(current);
        setWithdrawn(true);
      }
    } catch {
      if (currentToken === token.current)
        setError('Le retrait n’a pas pu être confirmé. Veuillez réessayer.');
    } finally {
      if (currentToken === token.current) setBusy(false);
    }
  }

  function addToCalendar() {
    if (!reservation?.startsAt || !confirmed) return;
    const escape = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, '\\$&');
    const stamp = (value: string) =>
      new Date(value)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Sokar//Reservation//FR',
      'BEGIN:VEVENT',
      `UID:${crypto.randomUUID()}@sokar.tech`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(reservation.startsAt)}`,
      ...(reservation.endsAt ? [`DTEND:${stamp(reservation.endsAt)}`] : []),
      `SUMMARY:${escape(`${demo ? '[Démonstration] ' : ''}Table chez ${reservation.restaurantName}`)}`,
      `DESCRIPTION:${escape(`Réservation pour ${reservation.partySize} ${reservation.partySize === 1 ? 'personne' : 'personnes'}.`)}`,
      ...(reservation.restaurantAddress
        ? [`LOCATION:${escape(reservation.restaurantAddress)}`]
        : []),
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = demo ? 'reservation-demo.ics' : 'reservation.ics';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const bookingDate = reservation ? new Date(`${reservation.date}T12:00:00Z`) : null;
  const confirmed = reservation?.state === 'CONFIRMED';
  const terminal = ['CANCELLED', 'EXPIRED', 'FAILED', 'NO_SHOW'].includes(reservation?.state ?? '');
  const StatusIcon = confirmed ? Check : terminal ? CircleX : CircleDashed;

  return (
    <main className={cn(styles.page, 'min-h-screen bg-background text-foreground')}>
      <div className={styles.shell}>
        <header className={styles.navigation}>
          <div className="flex items-center gap-2">
            <SokarLogo className="h-5 w-5 text-foreground" />
            <span className="font-serif text-xl">Sokar</span>
          </div>
          <div className="text-right">
            <h1 className="text-xs">Ma réservation</h1>
            {demo && <p className={styles.demo}>Démonstration · Réservation fictive</p>}
          </div>
        </header>
        {loading ? (
          <div
            role="status"
            className="flex min-h-80 items-center justify-center gap-3 text-muted-foreground"
          >
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement de la réservation…
          </div>
        ) : reservation ? (
          <>
            <section aria-label="Détails de la réservation" className={styles.booking}>
              <p role="status" data-terminal={terminal} className={styles.status}>
                <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {confirmed ? 'Confirmée' : (STATES[reservation.state] ?? 'Enregistrée')}
              </p>
              <h2 className={styles.restaurant}>{reservation.restaurantName}</h2>
              {reservation.restaurantAddress && (
                <p className={styles.address}>
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {reservation.restaurantAddress}
                </p>
              )}
              <dl className={styles.fan}>
                <div className={cn(styles.ticket, styles.dateTicket)}>
                  <dt className="sr-only">Date</dt>
                  <dd className={styles.ticketBody}>
                    <span className={styles.weekday}>
                      {bookingDate &&
                        new Intl.DateTimeFormat('fr-FR', {
                          weekday: 'long',
                          timeZone: 'UTC',
                        }).format(bookingDate)}
                    </span>
                    <span className={styles.largeNumber}>{bookingDate?.getUTCDate()}</span>
                    <span className={styles.ticketCaption}>
                      {bookingDate &&
                        new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' }).format(
                          bookingDate,
                        )}{' '}
                      {bookingDate?.getUTCFullYear()}
                    </span>
                  </dd>
                </div>
                <div className={cn(styles.ticket, styles.timeTicket)}>
                  <dt className="sr-only">Heure</dt>
                  <dd className={styles.ticketBody}>
                    <span className={styles.timeNumber}>{reservation.time}</span>
                  </dd>
                </div>
                <div className={cn(styles.ticket, styles.guestsTicket)}>
                  <dt className="sr-only">Couverts</dt>
                  <dd className={styles.ticketBody}>
                    <span className={styles.largeNumber}>{reservation.partySize}</span>
                    <span className={styles.ticketCaption}>
                      {reservation.partySize === 1 ? 'personne' : 'personnes'}
                    </span>
                  </dd>
                </div>
              </dl>
              <div className={styles.primaryActions}>
                {confirmed && reservation.startsAt && (
                  <Button
                    onClick={addToCalendar}
                    variant="link"
                    className={cn(styles.calendar, 'min-h-11 transition-all duration-200')}
                  >
                    Ajouter au calendrier
                  </Button>
                )}
                {reservation.restaurantAddress &&
                  (demo ? (
                    <Button
                      disabled
                      variant="link"
                      title="Indisponible dans la démonstration"
                      className={cn(styles.directions, 'min-h-11 transition-all duration-200')}
                    >
                      Itinéraire
                    </Button>
                  ) : (
                    <Button
                      asChild
                      variant="link"
                      className={cn(styles.directions, 'min-h-11 transition-all duration-200')}
                    >
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${reservation.restaurantName}, ${reservation.restaurantAddress}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                      >
                        Itinéraire
                      </a>
                    </Button>
                  ))}
              </div>
            </section>
            <details className={styles.management}>
              <summary className={cn(styles.managementToggle, 'transition-all duration-200')}>
                Modifier ou annuler
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </summary>
              <div className={styles.details}>
                {reservation.whatsappReminder.visible && (
                  <details className={styles.preferences} aria-busy={busy}>
                    <summary
                      className={cn(styles.preferencesToggle, 'transition-all duration-200')}
                    >
                      <span>Préférences de rappel</span>
                      <ChevronDown
                        className={cn(styles.chevron, 'h-3.5 w-3.5')}
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="mt-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <label
                          htmlFor="whatsapp-reminder"
                          className="flex items-center gap-2 text-sm"
                        >
                          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> Rappel
                          WhatsApp
                        </label>
                        <p
                          id="reminder-description"
                          className="mt-2 max-w-56 text-xs leading-relaxed text-muted-foreground"
                        >
                          {reservation.whatsappReminder.enabled
                            ? 'Rappel autorisé.'
                            : 'Rappel désactivé.'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        <span
                          className="flex h-4 w-4 items-center justify-center"
                          aria-live="polite"
                        >
                          {busy && (
                            <Loader2 className="h-4 w-4 animate-spin" aria-label="Enregistrement" />
                          )}
                        </span>
                        <Switch
                          id="whatsapp-reminder"
                          aria-describedby="reminder-description"
                          checked={reservation.whatsappReminder.enabled}
                          onCheckedChange={() => void withdraw()}
                          disabled={busy || !reservation.whatsappReminder.enabled}
                          className="transition-all duration-200"
                        />
                      </div>
                    </div>
                    {withdrawn && (
                      <p
                        role="status"
                        className="mt-4 text-xs leading-relaxed text-muted-foreground"
                      >
                        Votre accord a été retiré. Un rappel déjà en cours peut encore arriver.
                      </p>
                    )}
                  </details>
                )}
                <section className={styles.contactGroup}>
                  {demo ? (
                    <button
                      type="button"
                      disabled
                      title="Indisponible dans la démonstration"
                      className={styles.manageLink}
                    >
                      Modifier ou annuler
                    </button>
                  ) : reservation.restaurantPhone ? (
                    <a
                      href={`tel:${reservation.restaurantPhone.replace(/[^+0-9]/g, '')}`}
                      title="Contacter le restaurant par téléphone pour modifier ou annuler"
                      className={cn(styles.manageLink, 'transition-all duration-200')}
                    >
                      Modifier ou annuler
                    </a>
                  ) : (
                    <span className={styles.manageLabel}>Modifier ou annuler</span>
                  )}
                  {demo ? (
                    <Button
                      disabled
                      title="Indisponible dans la démonstration"
                      variant="outline"
                      className={cn(styles.contact, 'min-h-11 transition-all duration-200')}
                    >
                      <Phone className="mr-2 h-4 w-4" /> Appeler le restaurant
                    </Button>
                  ) : reservation.restaurantPhone ? (
                    <Button
                      asChild
                      variant="outline"
                      className={cn(styles.contact, 'min-h-11 transition-all duration-200')}
                    >
                      <a href={`tel:${reservation.restaurantPhone.replace(/[^+0-9]/g, '')}`}>
                        <Phone className="mr-2 h-4 w-4" /> Appeler le restaurant
                      </a>
                    </Button>
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Veuillez contacter directement le restaurant.
                    </p>
                  )}
                </section>
              </div>
            </details>
          </>
        ) : null}
        {error && (
          <div className="my-10 border-l-2 border-destructive pl-4">
            <p role="alert" className="text-sm">
              {error}
            </p>
            <Button
              variant="outline"
              onClick={() => (reservation ? void withdraw() : void load())}
              className="mt-3 min-h-11 transition-all duration-200"
            >
              Réessayer
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
