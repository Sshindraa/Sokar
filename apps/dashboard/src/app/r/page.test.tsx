import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';
import ReservationView from './reservation-view';

const token = `${'a'.repeat(27)}.${'b'.repeat(43)}`;
const data = {
  restaurantName: 'Restaurant Exemple',
  restaurantPhone: '+33100000000',
  date: '2026-10-18',
  time: '19:00',
  partySize: 2,
  state: 'CONFIRMED',
  whatsappReminder: { visible: true, enabled: true },
};
describe('Ma reservation', () => {
  it('previews the same UI without network calls or a dialable phone', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<ReservationView demo />);
    expect(await screen.findByText('Restaurant Exemple')).toBeInTheDocument();
    expect(screen.getByText(/Réservation fictive/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Appeler le restaurant', hidden: true }),
    ).toBeDisabled();
    expect(screen.getByText('Préférences de rappel').closest('details')).not.toHaveAttribute(
      'open',
    );
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByText('Préférences de rappel'));
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText(/Votre accord a été retiré/)).toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(fetch).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    window.history.replaceState(null, '', `/r#${token}`);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it('reads details without posting any mutation and puts the token only in the POST body', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(data));
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    expect(await screen.findByText('Restaurant Exemple')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/reservation-management',
      expect.objectContaining({
        body: JSON.stringify({ token, action: 'view' }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
    );
    expect(
      screen.getByRole('link', { name: 'Appeler le restaurant', hidden: true }),
    ).toHaveAttribute('href', 'tel:+33100000000');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('only announces withdrawal after server acknowledgement', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(data))
      .mockResolvedValueOnce(
        Response.json({ ...data, whatsappReminder: { visible: true, enabled: false } }),
      );
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByText('Préférences de rappel'));
    fireEvent.click(screen.getByRole('switch', { name: 'Rappel WhatsApp' }));
    expect(await screen.findByText(/Votre accord a été retiré/)).toBeInTheDocument();
    expect(fetch.mock.calls[1][1].body).toBe(
      JSON.stringify({ token, action: 'withdraw_whatsapp' }),
    );
    expect(screen.getByRole('switch')).not.toBeChecked();
  });
  it('keeps the previous state when withdrawal fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(data))
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
    );
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByText('Préférences de rappel'));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Le retrait n’a pas pu être confirmé'),
    );
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.queryByText(/Votre accord a été retiré/)).not.toBeInTheDocument();
  });
  it('requires explicit confirmation and updates the carton only after cancellation succeeds', async () => {
    const cancellation = {
      available: true,
      deadline: '2026-10-18T15:00:00Z',
      message: 'Annulation gratuite avant 17 h.',
      terms: 'Conditions enregistrées.',
      confirmationToken: 'quote',
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...data, cancellation }))
      .mockResolvedValueOnce(
        Response.json({
          ...data,
          state: 'CANCELLED',
          cancellation: { ...cancellation, available: false },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Conserver ma réservation' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’annulation' }));
    expect(await screen.findByText('Annulée')).toBeInTheDocument();
    expect(fetch.mock.calls[1][1].body).toBe(
      JSON.stringify({ token, action: 'cancel', confirmed: true, confirmationToken: 'quote' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter au calendrier' })).not.toBeInTheDocument();
  });
  it('recovers the actual cancellation state after a lost server response', async () => {
    const cancellation = {
      available: true,
      deadline: null,
      message: 'Annulation gratuite.',
      confirmationToken: 'quote',
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...data, cancellation }))
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(
        Response.json({
          ...data,
          state: 'CANCELLED',
          cancellation: { ...cancellation, available: false },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’annulation' }));
    expect(await screen.findByText('Annulée')).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[2][1].body).action).toBe('view');
  });
  it('preserves the current carton during selection and only modifies after review and confirmation', async () => {
    const initial = {
      ...data,
      modification: { available: true, message: 'Réservation conservée.' },
    };
    const choices = {
      date: data.date,
      partySize: 2,
      maxPartySize: 4,
      slots: [{ time: '20:00', proposalToken: 'offer' }],
      message: 'Réservation conservée.',
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(Response.json(choices))
      .mockResolvedValueOnce(Response.json({ ...initial, time: '20:00' }));
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier la réservation' }));
    fireEvent.click(await screen.findByRole('radio', { name: '20:00' }));
    expect(screen.getByText('19:00')).toBeInTheDocument();
    expect(fetch.mock.calls.map((call) => JSON.parse(call[1].body).action)).toEqual([
      'view',
      'view',
      'modification_options',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier ce changement' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Nouveau choix');
    expect(fetch).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('20:00')).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({
      token,
      action: 'modify',
      confirmed: true,
      proposalToken: 'offer',
    });
  });
  it('does not mutate when the customer closes the modification dialog', async () => {
    const initial = { ...data, modification: { available: true, message: 'Conservée' } };
    const fetch = vi.fn().mockImplementation(async (_url, options) =>
      JSON.parse(options.body).action === 'modification_options'
        ? Response.json({
            date: data.date,
            partySize: 2,
            maxPartySize: 4,
            slots: [],
            message: 'Aucun autre créneau disponible.',
          })
        : Response.json(initial),
    );
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier la réservation' }));
    await screen.findByText('Aucun autre créneau disponible.');
    fireEvent.click(screen.getByRole('button', { name: 'Conserver ma réservation' }));
    expect(fetch.mock.calls.every((call) => JSON.parse(call[1].body).action !== 'modify')).toBe(
      true,
    );
    expect(screen.getByText('19:00')).toBeInTheDocument();
  });
  it('recovers an applied modification after a lost response without sending it twice', async () => {
    const initial = { ...data, modification: { available: true, message: 'Conservée' } };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(
        Response.json({
          date: data.date,
          partySize: 2,
          maxPartySize: 4,
          slots: [{ time: '20:00', proposalToken: 'offer' }],
          message: 'Conservée',
        }),
      )
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(Response.json({ ...initial, time: '20:00' }));
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier la réservation' }));
    fireEvent.click(await screen.findByRole('radio', { name: '20:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier ce changement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('20:00')).toBeInTheDocument();
    expect(
      fetch.mock.calls.filter((call) => JSON.parse(call[1].body).action === 'modify'),
    ).toHaveLength(1);
  });
  it('keeps an unconfirmed change visible as an error in French after a network failure', async () => {
    const initial = { ...data, modification: { available: true, message: 'Conservée' } };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(
        Response.json({
          date: data.date,
          partySize: 2,
          maxPartySize: 4,
          slots: [{ time: '20:00', proposalToken: 'offer' }],
          message: 'Conservée',
        }),
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json(initial));
    vi.stubGlobal('fetch', fetch);
    render(<Page />);
    await screen.findByText('Restaurant Exemple');
    fireEvent.click(document.querySelector('details > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier la réservation' }));
    fireEvent.click(await screen.findByRole('radio', { name: '20:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier ce changement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La modification n’a pas pu être confirmée',
    );
    expect(screen.getByText('19:00')).toBeInTheDocument();
    expect(
      fetch.mock.calls.filter((call) => JSON.parse(call[1].body).action === 'modify'),
    ).toHaveLength(1);
  });
  it('shows an expired link without disclosing stale details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    render(<Page />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien est invalide ou a expiré');
    expect(screen.queryByText('Restaurant Exemple')).not.toBeInTheDocument();
  });
  it.each([
    ['PENDING', 'En attente'],
    ['CANCELLED', 'Annulée'],
  ])('does not label a %s booking as confirmed', async (state, label) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...data, state })));
    render(<Page />);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText('Réservation confirmée')).not.toBeInTheDocument();
  });
});
