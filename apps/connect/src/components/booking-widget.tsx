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
 *
 * Sous-composants : PartySizePicker, SlotGrid, CustomerForm, ConfirmationView
 * (cf. apps/connect/src/components/booking/).
 */

import { useState, useEffect, useCallback } from 'react';
import { PartySizePicker } from './booking/party-size-picker';
import { SlotGrid } from './booking/slot-grid';
import { CustomerForm } from './booking/customer-form';
import { ConfirmationView, type ConfirmDto } from './booking/confirmation-view';
import { trackEvent } from '@/lib/tracking';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch avec timeout via AbortController.
 * Si la requête dépasse FETCH_TIMEOUT_MS, elle est abortée et throw une erreur.
 */
function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

type Slot = { time: string; available: boolean };
type AvailabilityDto = { date: string; partySize: number; slots: Slot[] };
type PublicRestaurant = {
  id: string;
  slug: string;
  name: string;
  connectAgentic: boolean;
  address: { city: string };
};

type HoldDto = {
  holdId: string;
  holdToken: string;
  expiresAt: string;
  status: 'pending';
  sourceNormalized?: string;
};

type Props = {
  slug: string;
  initialSource?: string;
  initialPartySize?: number;
  initialDate?: string;
  initialTime?: string;
  embedded?: boolean;
  primaryColor?: string;
  accentColor?: string;
};

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
  embedded = false,
  primaryColor = '#0F172A',
  accentColor = '#EA580C',
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
  // Idempotency key générée une fois par tentative de réservation (pas à chaque submit)
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // Load restaurant info once
  useEffect(() => {
    fetch(`${API_URL}/public/widget/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return setRestaurant(null);
        setRestaurant({
          id: data.id,
          slug: data.slug ?? slug,
          name: data.name,
          connectAgentic: data.connectAgentic ?? false,
          address: { city: data.city ?? data.address?.city ?? '' },
        });
      })
      .catch(() => setRestaurant(null));
  }, [slug]);

  // Auto-resize iframe when embedded
  useEffect(() => {
    if (!embedded) return;
    const sendHeight = () => {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ type: 'sokar-widget-resize', height }, '*');
    };
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [embedded]);

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
      const res = await fetchWithTimeout(
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
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('La requête a expiré. Vérifiez votre connexion et réessayez.');
      } else {
        setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
      }
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
      const holdRes = await fetchWithTimeout(`${API_URL}/public/r/${slug}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time: selectedTime, partySize, source, website: honeypot }),
      });
      if (!holdRes.ok) {
        const data = await holdRes.json().catch(() => ({}));
        setError(data.error || 'Créneau déjà réservé. Choisissez un autre horaire.');
        return;
      }
      const hold: HoldDto = await holdRes.json();

      // 2. Confirm — Idempotency-Key réutilisée (générée au step "confirm")
      const confirmRes = await fetchWithTimeout(`${API_URL}/public/r/${slug}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdToken: hold.holdToken,
          idempotencyKey,
          source,
          website: honeypot,
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
        // 410 = hold expiré → retour step 1 avec message clair
        if (confirmRes.status === 410) {
          setStep('pick');
          setSelectedTime(null);
          setSlots([]);
          setError(
            'Votre créneau a expiré (délai de 5 minutes dépassé). ' +
              'Veuillez sélectionner un nouvel horaire.',
          );
          return;
        }
        // 409 = conflit (déjà réservé ou idempotency mismatch)
        if (confirmRes.status === 409) {
          setStep('pick');
          setSelectedTime(null);
          setSlots([]);
          setError(
            data.error || 'Ce créneau vient d\u2019être réservé. Veuillez en choisir un autre.',
          );
          return;
        }
        // 429 = rate limit per-phone
        if (confirmRes.status === 429) {
          setError(
            'Trop de tentatives. Veuillez réessayer dans une heure ou appelez le restaurant.',
          );
          return;
        }
        setError(data.error || 'La réservation a échoué. Réessayez ou appelez le restaurant.');
        return;
      }
      const result: ConfirmDto = await confirmRes.json();
      setConfirmResult(result);
      setStep('done');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('La requête a expiré. Vérifiez votre connexion et réessayez.');
      } else {
        setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
      }
    } finally {
      setLoading(false);
    }
  }

  const widgetStyle = {
    '--widget-primary': primaryColor,
    '--widget-accent': accentColor,
    '--widget-accent-light': `color-mix(in srgb, ${accentColor} 10%, transparent)`,
  } as React.CSSProperties;

  return (
    <div style={widgetStyle}>
      {step === 'done' && confirmResult ? (
        <ConfirmationView result={confirmResult} slug={slug} embedded={embedded} />
      ) : step === 'confirm' && selectedTime ? (
        <form onSubmit={handleConfirm} className="space-y-4">
          <div className="rounded-xl border border-border bg-cream p-4">
            <p className="text-sm text-[var(--widget-primary)]">
              <strong>{partySize}</strong> personne{partySize > 1 ? 's' : ''} ·{' '}
              <strong>{date}</strong> à <strong>{selectedTime}</strong>
            </p>
          </div>

          <CustomerForm
            firstName={firstName}
            setFirstName={setFirstName}
            phone={phone}
            setPhone={setPhone}
            email={email}
            setEmail={setEmail}
            specialRequests={specialRequests}
            setSpecialRequests={setSpecialRequests}
            honeypot={honeypot}
            setHoneypot={setHoneypot}
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-[var(--widget-accent)] px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
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
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-base font-semibold text-[var(--widget-primary)] transition-all duration-200 hover:bg-muted disabled:opacity-50"
            >
              ← Changer d'horaire
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {/* Lien vers l'achat de carte cadeau */}
          <div className="flex justify-end">
            <a
              href={`/widget/${slug}/gift-card?embedded=${embedded ? '1' : '0'}&primary=${primaryColor.replace('#', '')}&accent=${accentColor.replace('#', '')}&source=${source}`}
              className="text-sm font-medium underline-offset-2 transition-all duration-200 hover:underline"
              style={{ color: accentColor }}
            >
              Offrir une carte cadeau
            </a>
          </div>

          <PartySizePicker value={partySize} onChange={setPartySize} />

          <div>
            <label
              htmlFor="date"
              className="block text-sm font-medium text-[var(--widget-primary)]"
            >
              Date
            </label>
            <input
              id="date"
              type="date"
              value={date}
              min={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[var(--widget-primary)] focus:border-[var(--widget-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--widget-accent)]"
            />
          </div>

          <button
            type="button"
            onClick={loadAvailability}
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--widget-accent)] px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Chargement...' : 'Voir les disponibilités'}
          </button>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <SlotGrid
            slots={slots}
            onSelect={(time) => {
              setSelectedTime(time);
              setStep('confirm');
              // Générer l'idempotency key une fois par sélection de slot.
              // Réutilisée pour hold + confirm → protège contre le double submit.
              setIdempotencyKey(crypto.randomUUID());
              if (restaurant) {
                trackEvent({
                  event: 'availability_slot_selected',
                  restaurantId: restaurant.id,
                  restaurantSlug: restaurant.slug,
                  date,
                  time,
                  partySize,
                  source,
                });
              }
            }}
          />

          {restaurant && !restaurant.connectAgentic && !embedded && (
            <p className="text-xs text-muted-foreground">
              Source : <code className="rounded bg-muted px-1">{source}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
