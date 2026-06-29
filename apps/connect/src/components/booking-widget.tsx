'use client';

/**
 * Sokar Connect — BookingWidget.
 *
 * Flow (cf. spec v1.1 §7.3) :
 *   1. Select party size
 *   2. Select date
 *   3. Click "Voir les dispos" → fetch availability
 *   4. Select time slot
 *   5. Click "Réserver" → POST /hold → POST /confirm
 *   6. Show confirmation screen
 *
 * Tout en client component, pas de Server Component nécessaire.
 * Le hold est côté serveur (5 min TTL), le confirm aussi.
 *
 * Honeypot : un input `website` caché. Si rempli, on abort (bot signal).
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Slot = { time: string; available: boolean };
type AvailabilityDto = { date: string; partySize: number; slots: Slot[] };
type PublicRestaurant = {
  id: string;
  slug: string;
  name: string;
  connectAgentic: boolean;
  address: { city: string };
};

type HoldDto = { holdToken: string; expiresAt: string; status: 'pending' };
type ConfirmDto = {
  reservationId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
};

type Props = {
  slug: string;
  initialSource?: string;
  initialPartySize?: number;
  initialDate?: string;
  initialTime?: string;
};

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= todayIso();
}

export function BookingWidget({
  slug,
  initialSource,
  initialPartySize,
  initialDate,
  initialTime,
}: Props) {
  const [step, setStep] = useState<'pick' | 'confirm' | 'done'>('pick');
  const [restaurant, setRestaurant] = useState<PublicRestaurant | null>(null);
  const [partySize, setPartySize] = useState<number>(initialPartySize ?? 2);
  const [date, setDate] = useState<string>(initialDate ?? todayIso());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedTime, setSelectedTime] = useState<string | null>(initialTime ?? null);
  const [firstName, setFirstName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [specialRequests, setSpecialRequests] = useState<string>('');
  // Honeypot (anti-bot). Si rempli, on bloque la soumission.
  const [honeypot, setHoneypot] = useState<string>('');
  const [source] = useState<string>(initialSource ?? 'web');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmDto | null>(null);

  // Load restaurant info once
  useEffect(() => {
    fetch(`${API_URL}/public/r/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRestaurant(data))
      .catch(() => setRestaurant(null));
  }, [slug]);

  // Load availability
  const loadAvailability = useCallback(async () => {
    if (!isValidDate(date)) {
      setError('Date invalide');
      return;
    }
    setLoading(true);
    setError(null);
    setSlots([]);
    setSelectedTime(null);
    try {
      const res = await fetch(
        `${API_URL}/public/r/${slug}/availability?date=${date}&partySize=${partySize}`,
      );
      if (!res.ok) {
        setError('Impossible de charger les disponibilités');
        return;
      }
      const data: AvailabilityDto = await res.json();
      setSlots(data.slots);
      // Pre-select the initial time if it's in the list and available
      if (initialTime && data.slots.find((s) => s.time === initialTime && s.available)) {
        setSelectedTime(initialTime);
      }
    } catch (err) {
      setError('Erreur réseau. Réessayez.');
    } finally {
      setLoading(false);
    }
  }, [slug, date, partySize, initialTime]);

  // Load availability on mount if date+time pre-filled
  useEffect(() => {
    if (initialDate && initialTime) {
      loadAvailability();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (honeypot) {
      // Bot detected. Silent fail.
      setError('Une erreur est survenue. Réessayez.');
      return;
    }
    if (!selectedTime) {
      setError('Veuillez sélectionner un horaire');
      return;
    }
    if (!firstName.trim()) {
      setError('Veuillez renseigner votre prénom');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      setError('Numéro de téléphone invalide (format international +33...)');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Hold
      const holdRes = await fetch(`${API_URL}/public/r/${slug}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time: selectedTime, partySize, source }),
      });
      if (!holdRes.ok) {
        const data = await holdRes.json().catch(() => ({}));
        setError(data.error || 'Créneau déjà réservé. Choisissez un autre horaire.');
        return;
      }
      const hold: HoldDto = await holdRes.json();

      // 2. Confirm
      const confirmRes = await fetch(`${API_URL}/public/r/${slug}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdToken: hold.holdToken,
          customer: {
            firstName: firstName.trim(),
            phone: phone.trim(),
            ...(email.trim() ? { email: email.trim() } : {}),
          },
          specialRequests: specialRequests.trim() || undefined,
        }),
      });
      if (!confirmRes.ok) {
        const data = await confirmRes.json().catch(() => ({}));
        setError(data.error || 'La réservation a échoué. Réessayez ou appelez le restaurant.');
        return;
      }
      const result: ConfirmDto = await confirmRes.json();
      setConfirmResult(result);
      setStep('done');
    } catch (err) {
      setError('Erreur réseau. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  // Confirmation screen
  if (step === 'done' && confirmResult) {
    return (
      <div className="rounded-xl border border-border bg-cream p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ember text-white">
            ✓
          </div>
          <h2 className="text-xl font-semibold text-ink">Réservation confirmée</h2>
        </div>
        <p className="text-ink">
          Votre table chez <strong>{confirmResult.restaurantName}</strong> est réservée pour{' '}
          <strong>
            {confirmResult.partySize} personne{confirmResult.partySize > 1 ? 's' : ''}
          </strong>{' '}
          le <strong>{confirmResult.date}</strong> à <strong>{confirmResult.time}</strong>.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Code de réservation :{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {confirmResult.reservationId}
          </code>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Un SMS de confirmation vous a été envoyé.
        </p>
        <Link
          href={`/r/${slug}`}
          className="mt-6 inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-2 text-sm font-semibold text-ink transition-all duration-200 hover:bg-muted"
        >
          ← Retour à la fiche
        </Link>
      </div>
    );
  }

  // Confirm step (form)
  if (step === 'confirm' && selectedTime) {
    return (
      <form onSubmit={handleConfirm} className="space-y-4">
        <div className="rounded-xl border border-border bg-cream p-4">
          <p className="text-sm text-ink">
            <strong>{partySize}</strong> personne{partySize > 1 ? 's' : ''} ·{' '}
            <strong>{date}</strong> à <strong>{selectedTime}</strong>
          </p>
        </div>

        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-ink">
            Prénom *
          </label>
          <input
            id="firstName"
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-ink focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
            autoComplete="given-name"
            maxLength={100}
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-ink">
            Téléphone *{' '}
            <span className="font-normal text-muted-foreground">(format international)</span>
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+33612345678"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-ink focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
            autoComplete="tel"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink">
            Email{' '}
            <span className="font-normal text-muted-foreground">
              (optionnel, pour confirmation)
            </span>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-ink focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
            autoComplete="email"
          />
        </div>

        <div>
          <label htmlFor="specialRequests" className="block text-sm font-medium text-ink">
            Demandes spéciales{' '}
            <span className="font-normal text-muted-foreground">(optionnel)</span>
          </label>
          <textarea
            id="specialRequests"
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-ink focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
          />
        </div>

        {/* Honeypot — invisible, leave empty (bots fill all inputs) */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-ember px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:bg-ember/90 disabled:opacity-50"
          >
            {loading ? 'Réservation...' : 'Confirmer la réservation'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('pick');
              setError(null);
            }}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-base font-semibold text-ink transition-all duration-200 hover:bg-muted disabled:opacity-50"
          >
            ← Changer d'horaire
          </button>
        </div>
      </form>
    );
  }

  // Pick step
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="partySize" className="block text-sm font-medium text-ink">
          Nombre de personnes
        </label>
        <select
          id="partySize"
          value={partySize}
          onChange={(e) => setPartySize(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-ink focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
        >
          {PARTY_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'personne' : 'personnes'}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="date" className="block text-sm font-medium text-ink">
          Date
        </label>
        <input
          id="date"
          type="date"
          value={date}
          min={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-ink focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
        />
      </div>

      <button
        type="button"
        onClick={loadAvailability}
        disabled={loading}
        className="inline-flex w-full items-center justify-center rounded-lg bg-ember px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:bg-ember/90 disabled:opacity-50"
      >
        {loading ? 'Chargement...' : 'Voir les disponibilités'}
      </button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {slots.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-ink">Choisissez un horaire</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                disabled={!slot.available}
                onClick={() => {
                  setSelectedTime(slot.time);
                  setStep('confirm');
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  slot.available
                    ? 'border-border bg-background text-ink hover:border-ember hover:bg-ember/5'
                    : 'cursor-not-allowed border-border bg-muted text-muted-foreground line-through'
                }`}
              >
                {slot.time}
              </button>
            ))}
          </div>
        </div>
      )}

      {restaurant && !restaurant.connectAgentic && (
        <p className="text-xs text-muted-foreground">
          Source : <code className="rounded bg-muted px-1">{source}</code>
        </p>
      )}
    </div>
  );
}
