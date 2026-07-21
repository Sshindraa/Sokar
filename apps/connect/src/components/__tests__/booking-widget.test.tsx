/**
 * Tests unitaires pour le flux liste d'attente du BookingWidget.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BookingWidget } from '@/components/booking-widget';

vi.mock('@/lib/tracking', () => ({
  trackEvent: vi.fn(),
}));

const baseUrl = 'http://localhost:3001';
const slug = 'chez-sokar';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BookingWidget waiting list flow', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })) as unknown as typeof ResizeObserver;

    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => 'test-uuid' },
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = vi.fn();
  });

  function setFetchSequence(responses: Response[]) {
    const queue = [...responses];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const res = queue.shift();
      return Promise.resolve(res ?? new Response('not found', { status: 404 }));
    });
  }

  it('shows the waiting list option when hold returns 409 with waitingListEnabled true', async () => {
    setFetchSequence([
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        city: 'Paris',
        sections: [],
      }),
      jsonResponse({ date: todayIso(), partySize: 2, slots: [{ time: '19:00', available: true }] }),
      jsonResponse({ error: 'no_table_available', waitingListEnabled: true }, 409),
    ]);

    render(<BookingWidget slug={slug} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^Date/i), { target: { value: todayIso() } });
    fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer la réservation/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
    fireEvent.change(screen.getByLabelText(/^Téléphone/i), { target: { value: '+33612345678' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/ce créneau est complet\. souhaitez-vous rejoindre la file d'attente/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /rejoindre la file d'attente/i }),
      ).toBeInTheDocument();
    });
  });

  it('joins the waiting list and shows the position and token', async () => {
    setFetchSequence([
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        city: 'Paris',
        sections: [],
      }),
      jsonResponse({ date: todayIso(), partySize: 2, slots: [{ time: '19:00', available: true }] }),
      jsonResponse({ error: 'no_table_available', waitingListEnabled: true }, 409),
      jsonResponse({
        entryId: 'wl-1',
        position: 3,
        actionToken: 'wl-abc',
        expiresAt: '2026-07-21T10:00:00.000Z',
      }),
    ]);

    render(<BookingWidget slug={slug} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^Date/i), { target: { value: todayIso() } });
    fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer la réservation/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
    fireEvent.change(screen.getByLabelText(/^Téléphone/i), { target: { value: '+33612345678' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /rejoindre la file d'attente/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /rejoindre la file d'attente/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer l'inscription/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmer l'inscription/i }));

    await waitFor(() => {
      expect(screen.getByText(/position indicative/i)).toHaveTextContent(/3/);
      expect(screen.getByText('wl-abc')).toBeInTheDocument();
      expect(screen.getByText(/un e-mail\/sms vous préviendra/i)).toBeInTheDocument();
    });
  });

  it('shows the slot_now_available fallback and lets the user go back to slots', async () => {
    setFetchSequence([
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        city: 'Paris',
        sections: [],
      }),
      jsonResponse({ date: todayIso(), partySize: 2, slots: [{ time: '19:00', available: true }] }),
      jsonResponse({ error: 'no_table_available', waitingListEnabled: true }, 409),
      jsonResponse({ error: 'slot_now_available' }, 409),
    ]);

    render(<BookingWidget slug={slug} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^Date/i), { target: { value: todayIso() } });
    fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer la réservation/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
    fireEvent.change(screen.getByLabelText(/^Téléphone/i), { target: { value: '+33612345678' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /rejoindre la file d'attente/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /rejoindre la file d'attente/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer l'inscription/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmer l'inscription/i }));

    await waitFor(() => {
      expect(screen.getByText(/une table vient de se libérer/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /changer d’horaire/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /changer d’horaire/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /choisissez un horaire/i })).toBeInTheDocument(),
    );
  });

  it('cancels a waiting list entry', async () => {
    setFetchSequence([
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        city: 'Paris',
        sections: [],
      }),
      jsonResponse({ date: todayIso(), partySize: 2, slots: [{ time: '19:00', available: true }] }),
      jsonResponse({ error: 'no_table_available', waitingListEnabled: true }, 409),
      jsonResponse({
        entryId: 'wl-1',
        position: 3,
        actionToken: 'wl-abc',
        expiresAt: '2026-07-21T10:00:00.000Z',
      }),
      jsonResponse({ status: 'cancelled' }),
    ]);

    render(<BookingWidget slug={slug} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^Date/i), { target: { value: todayIso() } });
    fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer la réservation/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
    fireEvent.change(screen.getByLabelText(/^Téléphone/i), { target: { value: '+33612345678' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /rejoindre la file d'attente/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /rejoindre la file d'attente/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirmer l'inscription/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmer l'inscription/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /annuler mon inscription/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /annuler mon inscription/i }));

    await waitFor(() => {
      expect(screen.getByText(/votre inscription a été annulée/i)).toBeInTheDocument();
    });
  });
});
