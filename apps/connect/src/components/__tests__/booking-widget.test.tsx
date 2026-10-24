/**
 * Tests unitaires pour le flux liste d'attente du BookingWidget.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MARKETING_CONSENT_VERSION } from '@sokar/shared';
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

  function setFetchSequence(responses: Array<Response | Error>) {
    const queue = [...responses];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const response = queue.shift();
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response ?? new Response('not found', { status: 404 }));
    });
  }

  it.each([false, true])(
    'affiche un choix WhatsApp non précoché seulement si disponible (%s)',
    async (enabled) => {
      setFetchSequence([
        jsonResponse({
          id: 'rest-1',
          slug,
          name: 'Chez Sokar',
          connectAgentic: false,
          sections: [],
          whatsappReminderOptInEnabled: enabled,
        }),
        jsonResponse({
          date: todayIso(),
          partySize: 2,
          slots: [{ time: '19:00', available: true }],
        }),
      ]);
      render(<BookingWidget slug={slug} />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /confirmer la réservation/i }),
        ).toBeInTheDocument(),
      );
      const choice = screen.queryByRole('checkbox', { name: /rappel.*WhatsApp/i });
      if (enabled) expect(choice).not.toBeChecked();
      else expect(choice).not.toBeInTheDocument();
    },
  );

  it('shows the network error without presenting a false empty state', async () => {
    setFetchSequence([
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        city: 'Paris',
        sections: [],
      }),
      new Error('offline'),
    ]);

    render(<BookingWidget slug={slug} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));

    await waitFor(() => expect(screen.getByText(/erreur réseau/i)).toBeInTheDocument());
    expect(screen.queryByText(/aucun créneau disponible/i)).not.toBeInTheDocument();
  });

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
  it('passes the prefilled gift code to confirmation without a client-calculated debit', async () => {
    setFetchSequence([
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        giftCardEnabled: true,
        city: 'Paris',
        sections: [],
      }),
      jsonResponse({ date: todayIso(), partySize: 2, slots: [{ time: '19:00', available: true }] }),
      jsonResponse({ holdId: 'hold', holdToken: crypto.randomUUID(), status: 'pending' }),
      jsonResponse({ reservationId: 'reservation', status: 'confirmed' }),
    ]);
    render(<BookingWidget slug={slug} initialGiftCardCode="SKR-TEST-01" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));
    expect(screen.getByLabelText(/code carte cadeau/i)).toHaveValue('SKR-TEST-01');
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/^Téléphone/i), { target: { value: '+33600000000' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/public/r/${slug}/confirm`,
        expect.anything(),
      ),
    );
    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/confirm'));
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.giftCardCode).toBe('SKR-TEST-01');
    expect(body.giftCardReservationAmount).toBeUndefined();
  });

  describe('réservation test (jeton signé)', () => {
    const token = `${'a'.repeat(27)}.${'b'.repeat(43)}`;
    const banner =
      'Réservation test : vous voyez ce que voient vos clients. Les messages sont envoyés, mais rien n’apparaît dans votre restaurant.';
    const restaurantDto = {
      id: 'rest-1',
      giftCardEnabled: true,
      whatsappReminderOptInEnabled: true,
      slug,
      name: 'Chez Sokar',
      connectAgentic: false,
      city: 'Paris',
      sections: [],
    };
    const availability = () =>
      jsonResponse({
        date: todayIso(),
        partySize: 2,
        slots: [{ time: '19:00', available: true }],
      });

    async function fillAndConfirm(responses: Response[]) {
      setFetchSequence([jsonResponse(restaurantDto), availability(), ...responses]);
      render(
        <BookingWidget
          slug={slug}
          marketingAttributionToken={'x'.repeat(40)}
          testBookingToken={token}
        />,
      );
      expect(screen.getByText(banner)).toBeInTheDocument();
      expect(screen.queryByText('Offrir une carte cadeau')).not.toBeInTheDocument();
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));
      fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
      fireEvent.change(screen.getByLabelText(/^Téléphone/i), { target: { value: '+33612345678' } });
      fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));
    }

    const posts = () =>
      vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([, init]) => init?.method === 'POST')
        .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init?.body)) }));

    it('envoie le jeton à hold et confirm, sans attribution, et affiche la réponse réelle', async () => {
      await fillAndConfirm([
        jsonResponse({ holdId: 'h1', holdToken: 'ht1' }),
        jsonResponse({
          reservationId: 'res-123',
          restaurantName: 'Chez Sokar',
          date: todayIso(),
          time: '19:00',
          partySize: 2,
          managementUrl: 'https://sokar.tech/r/abc',
        }),
      ]);
      expect(await screen.findByText('Réservation confirmée')).toBeInTheDocument();
      expect(screen.getByText('res-123')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /gérer ma réservation/i })).toBeInTheDocument();
      const calls = posts();
      const hold = calls.find((c) => c.url.endsWith('/hold'));
      const confirm = calls.find((c) => c.url.endsWith('/confirm'));
      expect(hold?.body.testBookingToken).toBe(token);
      expect(confirm?.body.testBookingToken).toBe(token);
      expect(confirm?.body.marketingAttributionToken).toBeUndefined();
      expect(confirm?.body.whatsappReminderConsent).toBeUndefined();
      expect(confirm?.body.giftCardCode).toBeUndefined();
      expect(calls.some((c) => c.url.includes('/marketing/attribution/click'))).toBe(false);
    });

    it.each([403, 429])('affiche le message de l’API pour un hold refusé (%i)', async (status) => {
      await fillAndConfirm([jsonResponse({ error: 'Message du serveur.' }, status)]);
      expect(await screen.findByText('Message du serveur.')).toBeInTheDocument();
    });

    it.each([403, 429])(
      'affiche le message de l’API pour un confirm refusé (%i)',
      async (status) => {
        await fillAndConfirm([
          jsonResponse({ holdId: 'h1', holdToken: 'ht1' }),
          jsonResponse({ error: 'Message du serveur.' }, status),
        ]);
        expect(await screen.findByText('Message du serveur.')).toBeInTheDocument();
      },
    );
  });

  describe('consentement marketing facultatif', () => {
    async function reachConfirmForm() {
      setFetchSequence([
        jsonResponse({
          id: 'rest-1',
          slug,
          name: 'Chez Sokar',
          connectAgentic: false,
          city: 'Paris',
          sections: [],
        }),
        jsonResponse({
          date: todayIso(),
          partySize: 2,
          slots: [{ time: '19:00', available: true }],
        }),
        jsonResponse({ holdId: 'hold', holdToken: crypto.randomUUID(), status: 'pending' }),
        jsonResponse({ reservationId: 'reservation', status: 'confirmed' }),
      ]);
      render(<BookingWidget slug={slug} />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));
      fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
      fireEvent.change(screen.getByLabelText(/^Téléphone/i), {
        target: { value: '+33612345678' },
      });
    }

    function confirmBody() {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([url]) => String(url).endsWith('/confirm'));
      return JSON.parse(String(call?.[1]?.body));
    }

    it('reserve sans rien cocher : aucun bloc de consentement n’est envoyé', async () => {
      await reachConfirmForm();
      const sms = screen.getByRole('checkbox', { name: /par SMS/ });
      expect(sms).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));
      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${baseUrl}/public/r/${slug}/confirm`,
          expect.anything(),
        ),
      );
      expect(confirmBody().marketingConsent).toBeUndefined();
    });

    it('envoie les canaux cochés avec la version du texte, e-mail compris', async () => {
      await reachConfirmForm();
      expect(screen.queryByRole('checkbox', { name: /par e-mail/ })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/^E-?mail/i), {
        target: { value: 'marie@example.com' },
      });
      fireEvent.click(screen.getByRole('checkbox', { name: /par e-mail/ }));
      fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));
      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${baseUrl}/public/r/${slug}/confirm`,
          expect.anything(),
        ),
      );
      expect(confirmBody().marketingConsent).toEqual({
        email: true,
        version: MARKETING_CONSENT_VERSION,
      });
    });

    it('n’envoie pas une case cochée dont l’adresse a ensuite été effacée', async () => {
      await reachConfirmForm();
      const emailField = screen.getByLabelText(/^E-?mail/i);
      fireEvent.change(emailField, { target: { value: 'marie@example.com' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /par e-mail/ }));
      fireEvent.change(emailField, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));
      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${baseUrl}/public/r/${slug}/confirm`,
          expect.anything(),
        ),
      );
      expect(confirmBody().marketingConsent).toBeUndefined();
    });
  });

  describe('créneau trop proche (délai minimum du restaurant)', () => {
    const TOO_SOON_MESSAGE =
      'Ce créneau est trop proche : ce restaurant accepte les réservations au moins 2 h à l’avance.';
    const tooSoon = () =>
      jsonResponse(
        { error: TOO_SOON_MESSAGE, code: 'INSUFFICIENT_LEAD_TIME', minLeadTimeMinutes: 120 },
        409,
      );
    const restaurant = () =>
      jsonResponse({
        id: 'rest-1',
        slug,
        name: 'Chez Sokar',
        connectAgentic: false,
        city: 'Paris',
        sections: [],
      });
    const slots = () =>
      jsonResponse({ date: todayIso(), partySize: 2, slots: [{ time: '19:00', available: true }] });

    async function submitFromSlots() {
      render(<BookingWidget slug={slug} />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /voir les disponibilités/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /créneau à 19:00/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /créneau à 19:00/i }));
      fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: 'Marie' } });
      fireEvent.change(screen.getByLabelText(/^Téléphone/i), {
        target: { value: '+33612345678' },
      });
      fireEvent.click(screen.getByRole('button', { name: /confirmer la réservation/i }));
    }

    it('affiche le message français du serveur quand le hold est refusé, sans proposer la file d’attente', async () => {
      setFetchSequence([restaurant(), slots(), tooSoon()]);

      await submitFromSlots();

      expect(await screen.findByText(TOO_SOON_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(/créneau déjà réservé/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /rejoindre la file d'attente/i }),
      ).not.toBeInTheDocument();
    });

    it('affiche le message français du serveur quand la confirmation est refusée, et revient aux horaires', async () => {
      setFetchSequence([
        restaurant(),
        slots(),
        jsonResponse({ holdId: 'hold', holdToken: 'tok', status: 'pending' }),
        tooSoon(),
      ]);

      await submitFromSlots();

      expect(await screen.findByText(TOO_SOON_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(/réservation a échoué/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Internal error/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /confirmer la réservation/i })).toBeNull();
    });
  });
});
