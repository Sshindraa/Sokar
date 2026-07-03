'use client';

/**
 * Sokar Connect — GiftCardSlotsPicker.
 *
 * Affiche les 3 créneaux proposés par l'API. Au clic, demande les infos
 * du bénéficiaire puis appelle /book pour confirmer la réservation.
 */

import { useState } from 'react';
import type { GiftCardSlot, GiftCardBookResult } from '@/lib/api/gift-cards';
import { bookGiftCardSlot } from '@/lib/api/gift-cards';

type Props = {
  code: string;
  slots: GiftCardSlot[];
  primaryColor?: string;
  accentColor?: string;
  onBooked?: (result: GiftCardBookResult) => void;
};

export function GiftCardSlotsPicker({
  code,
  slots,
  primaryColor = '#0F172A',
  accentColor = '#EA580C',
  onBooked,
}: Props) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  // Honeypot (anti-bot). Si rempli, on bloque la soumission.
  const [honeypot, setHoneypot] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<GiftCardBookResult | null>(null);

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (honeypot) {
      // Bot detected. Silent fail.
      setError('Une erreur est survenue. Réessayez.');
      return;
    }
    if (selectedSlot === null) return;
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
      const result = await bookGiftCardSlot(code, {
        slotIndex: selectedSlot,
        customer: {
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          phone: phone.trim(),
          email: email.trim() || undefined,
        },
      });
      setBooked(result);
      onBooked?.(result);
    } catch (err: any) {
      setError(err.message || 'Réservation impossible. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  if (booked) {
    return (
      <div className="rounded-xl border border-border bg-cream p-6">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: accentColor }}
          >
            ✓
          </div>
          <h3 className="text-xl font-semibold" style={{ color: primaryColor }}>
            Réservation confirmée
          </h3>
        </div>
        <p style={{ color: primaryColor }}>
          Votre table est réservée. Code de réservation :{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{booked.reservationId}</code>
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-cream p-6 text-center">
        <p className="text-sm" style={{ color: primaryColor }}>
          Aucun créneau disponible pour le moment. Le destinataire pourra choisir sa date
          ultérieurement avec le code cadeau.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold" style={{ color: primaryColor }}>
          Choisissez un créneau
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          3 créneaux proposés parmi les disponibilités du restaurant.
        </p>
      </div>

      <div className="space-y-2">
        {slots.map((slot, idx) => (
          <button
            key={`${slot.date}-${slot.time}`}
            type="button"
            onClick={() => setSelectedSlot(idx)}
            className={`flex w-full items-center justify-between rounded-lg border p-4 transition-all duration-200 ${
              selectedSlot === idx ? 'border-2' : 'border-border bg-background hover:bg-muted'
            }`}
            style={
              selectedSlot === idx
                ? {
                    borderColor: accentColor,
                    backgroundColor: `color-mix(in srgb, ${accentColor} 5%, transparent)`,
                  }
                : undefined
            }
          >
            <div className="text-left">
              <p className="font-medium" style={{ color: primaryColor }}>
                {formatDate(slot.date)}
              </p>
              <p className="text-sm text-muted-foreground">{slot.time}</p>
            </div>
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                selectedSlot === idx ? 'border-transparent text-white' : 'border-border'
              }`}
              style={selectedSlot === idx ? { backgroundColor: accentColor } : undefined}
            >
              {selectedSlot === idx && '✓'}
            </div>
          </button>
        ))}
      </div>

      {selectedSlot !== null && (
        <form onSubmit={handleBook} className="space-y-3">
          {/* Honeypot anti-bot — caché visuellement */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />

          <div className="rounded-lg border border-border bg-cream p-3">
            <p className="text-sm" style={{ color: primaryColor }}>
              <strong>{slots[selectedSlot].date}</strong> à{' '}
              <strong>{slots[selectedSlot].time}</strong>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium" style={{ color: primaryColor }}>
                Prénom
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium" style={{ color: primaryColor }}>
                Nom (optionnel)
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
                style={{ ['--tw-ring-color' as string]: accentColor }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Téléphone
            </label>
            <input
              type="tel"
              placeholder="+33612345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium" style={{ color: primaryColor }}>
              Email (optionnel)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1"
              style={{ ['--tw-ring-color' as string]: accentColor }}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-lg px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            {loading ? 'Réservation...' : 'Confirmer la réservation'}
          </button>
        </form>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
