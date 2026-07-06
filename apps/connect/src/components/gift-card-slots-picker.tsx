'use client';

/**
 * Sokar Connect — GiftCardSlotsPicker.
 *
 * Affiche les 3 créneaux proposés par l'API. Au clic, demande les infos
 * du bénéficiaire puis appelle /book pour confirmer la réservation.
 *
 * Design aligné avec le widget de réservation Sokar.
 */

import { useState, type CSSProperties } from 'react';
import { Check, Calendar, AlertCircle, Loader2 } from 'lucide-react';
import type { GiftCardSlot, GiftCardBookResult } from '@/lib/api/gift-cards';
import { bookGiftCardSlot } from '@/lib/api/gift-cards';

type Props = {
  code: string;
  slots: GiftCardSlot[];
  primaryColor?: string;
  accentColor?: string;
  onBooked?: (result: GiftCardBookResult) => void;
};

const reservationTheme: CSSProperties & Record<`--${string}`, string> = {
  '--reservation-bg': '34 32% 92%',
  '--reservation-wash': '34 38% 96%',
  '--reservation-panel': '0 0% 100%',
  '--reservation-ink': '24 10% 10%',
  '--reservation-soft': '24 6% 42%',
  '--reservation-muted': '24 5% 64%',
  '--reservation-line': '28 20% 88%',
  '--reservation-blue': '207 92% 52%',
};

export function GiftCardSlotsPicker({
  code,
  slots,
  primaryColor = '#0F172A',
  accentColor = '#0284C7',
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

  const panelClass =
    'rounded-[1.5rem] border border-white/70 bg-white/60 p-6 backdrop-blur-2xl shadow-sm';
  const inputClass =
    'w-full rounded-xl border border-[hsl(var(--reservation-line))] bg-white/70 px-4 py-3 text-[15px] font-medium text-[hsl(var(--reservation-ink))] placeholder:text-[hsl(var(--reservation-muted))] transition-all duration-200 focus:border-white/80 focus:bg-white/62 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';
  const labelClass =
    'block text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-soft))]';

  if (booked) {
    return (
      <div style={reservationTheme} className={panelClass}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--reservation-ink))] text-white shadow-lg shadow-black/10">
            <Check size={20} strokeWidth={3} />
          </div>
          <h3 className="font-display text-[1.25rem] font-black tracking-[-0.03em] text-[hsl(var(--reservation-ink))]">
            Réservation confirmée
          </h3>
        </div>
        <p className="text-[15px] font-medium text-[hsl(var(--reservation-ink))]">
          Votre table est réservée. Code de réservation :{' '}
          <code className="rounded-lg bg-[hsl(var(--reservation-wash))] px-2 py-1 font-mono text-[13px] font-bold text-[hsl(var(--reservation-blue))]">
            {booked.reservationId}
          </code>
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div style={reservationTheme} className={`${panelClass} text-center`}>
        <p className="text-[14px] font-medium text-[hsl(var(--reservation-soft))]">
          Aucun créneau disponible pour le moment. Le destinataire pourra choisir sa date
          ultérieurement avec le code cadeau.
        </p>
      </div>
    );
  }

  return (
    <div style={reservationTheme} className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-[hsl(var(--reservation-blue))]" />
          <h3 className="font-display text-[1.25rem] font-black tracking-[-0.03em] text-[hsl(var(--reservation-ink))]">
            Choisissez un créneau
          </h3>
        </div>
        <p className="mt-1 text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
          3 créneaux proposés parmi les disponibilités du restaurant.
        </p>
      </div>

      <div className="space-y-2.5">
        {slots.map((slot, idx) => (
          <button
            key={`${slot.date}-${slot.time}`}
            type="button"
            onClick={() => setSelectedSlot(idx)}
            className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
              selectedSlot === idx
                ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
            }`}
          >
            <div>
              <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                {formatDate(slot.date)}
              </p>
              <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                {slot.time}
              </p>
            </div>
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                selectedSlot === idx
                  ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                  : 'border-[hsl(var(--reservation-line))]'
              }`}
            >
              {selectedSlot === idx && <Check size={14} strokeWidth={3} />}
            </div>
          </button>
        ))}
      </div>

      {selectedSlot !== null && (
        <form onSubmit={handleBook} className="space-y-4">
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

          <div className="rounded-[1.1rem] border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-wash))] p-4">
            <p className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
              {slots[selectedSlot].date} à {slots[selectedSlot].time}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Prénom</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={`${inputClass} mt-2`}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Nom (optionnel)</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={`${inputClass} mt-2`}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Téléphone</label>
            <input
              type="tel"
              placeholder="+33612345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`${inputClass} mt-2`}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Email (optionnel)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} mt-2`}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-red-200/80 bg-red-50/80 p-4 backdrop-blur-sm">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-[13px] font-medium leading-snug text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[17px] font-extrabold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Réservation...
              </>
            ) : (
              'Confirmer la réservation'
            )}
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
