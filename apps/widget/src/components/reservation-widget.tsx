'use client';

import { useState, useEffect } from 'react';
import { Calendar, Users, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type RestaurantReservationInput = {
  restaurant_id: string;
  restaurant_name?: string;
  restaurant_image?: string;
  restaurant_address?: {
    address: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
  };
};

type WindowWithOpenAI = Window & {
  openai?: {
    toolInput?: RestaurantReservationInput;
    toolOutput?: unknown;
    setWidgetState?: (state: unknown) => void;
  };
};

/**
 * Lit les inputs passés par ChatGPT via window.openai.toolInput.
 * En standalone (hors ChatGPT), lit depuis l'URL ?restaurant_id=...
 */
function readToolInput(): RestaurantReservationInput | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithOpenAI;
  if (w.openai?.toolInput) return w.openai.toolInput;

  // Fallback standalone (pour le dev local)
  const params = new URLSearchParams(window.location.search);
  const restaurant_id = params.get('restaurant_id');
  if (restaurant_id) {
    return {
      restaurant_id,
      restaurant_name: params.get('restaurant_name') || undefined,
    };
  }
  return null;
}

export function ReservationWidget() {
  const [input, setInput] = useState<RestaurantReservationInput | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [slotStart, setSlotStart] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(readToolInput());
  }, []);

  if (!input) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        En attente des données du restaurant…
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slotStart) {
      setError('Choisis une date et une heure');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    // Dans ChatGPT, on remonte le state au parent via window.openai.setWidgetState
    // ou window.openai.callTool('make_reservation', ...). En Phase 4 on
    // simule l'appel : on émet juste l'event et on confirme visuellement.
    const w = window as WindowWithOpenAI;
    if (w.openai?.setWidgetState) {
      w.openai.setWidgetState({ status: 'submitting', partySize, slotStart });
    }

    // Simule un délai d'appel réseau (2s) — en prod, ce sera un tool call
    await new Promise((r) => setTimeout(r, 2000));

    setSuccess('Réservation confirmée !');
    setSubmitting(false);
    if (w.openai?.setWidgetState) {
      w.openai.setWidgetState({ status: 'confirmed', partySize, slotStart });
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 animate-fade-in">
        <div className="flex items-center gap-2 text-primary">
          <CheckCircle2 size={20} />
          <p className="font-semibold">C&apos;est réservé !</p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {input.restaurant_name || 'Le restaurant'} t&apos;attend le{' '}
          <strong>{new Date(slotStart).toLocaleString('fr-FR')}</strong> pour{' '}
          <strong>{partySize}</strong> personne{partySize > 1 ? 's' : ''}.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-5 animate-fade-in"
    >
      <header>
        <h2 className="text-lg font-semibold leading-tight">
          {input.restaurant_name || 'Réserver une table'}
        </h2>
        {input.restaurant_address && (
          <p className="text-sm text-muted-foreground mt-1">
            {input.restaurant_address.address}, {input.restaurant_address.city}
          </p>
        )}
      </header>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Users size={14} />
          Nombre de personnes
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={partySize <= 1}
            onClick={() => setPartySize(partySize - 1)}
            className="h-9 w-9 rounded-md border border-border bg-background text-sm font-medium transition-all duration-200 hover:bg-muted disabled:opacity-50"
          >
            −
          </button>
          <span className="w-12 text-center text-base font-semibold tabular-nums">{partySize}</span>
          <button
            type="button"
            disabled={partySize >= 20}
            onClick={() => setPartySize(partySize + 1)}
            className="h-9 w-9 rounded-md border border-border bg-background text-sm font-medium transition-all duration-200 hover:bg-muted disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Calendar size={14} />
          Date et heure
        </label>
        <input
          type="datetime-local"
          value={slotStart}
          onChange={(e) => setSlotStart(e.target.value)}
          className={cn(
            'w-full h-10 rounded-md border border-border bg-background px-3 py-2 text-sm',
            'ring-offset-background transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
          required
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={cn(
          'w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium',
          'transition-all duration-200 hover:bg-primary/90',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'flex items-center justify-center gap-2',
        )}
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Réservation…
          </>
        ) : (
          'Confirmer la réservation'
        )}
      </button>
    </form>
  );
}
