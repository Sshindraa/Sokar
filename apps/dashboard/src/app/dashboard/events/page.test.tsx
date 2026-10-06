import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventsPage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, post: apiMocks.post, patch: apiMocks.patch }),
}));

const event = {
  id: 'event-1',
  key: 'wine-night',
  name: 'Soirée dégustation',
  description: null,
  timezone: 'Europe/Paris',
  status: 'ACTIVE',
  sessionCount: 1,
  ticketTypeCount: 1,
  orderCount: 1,
  waitlistCount: 0,
};
const session = {
  id: 'session-1',
  eventId: 'event-1',
  startsAt: '2026-09-20T18:00:00.000Z',
  endsAt: '2026-09-20T21:00:00.000Z',
  capacity: 20,
  status: 'OPEN',
  event: { key: 'wine-night', name: 'Soirée dégustation', status: 'ACTIVE' },
  orderCount: 1,
  ticketCount: 2,
  waitlistCount: 0,
};
const ticketType = {
  id: 'ticket-type-1',
  eventId: 'event-1',
  key: 'standard',
  name: 'Entrée standard',
  priceCents: 2500,
  currency: 'EUR',
  maxPerOrder: 5,
  status: 'ACTIVE',
  orderCount: 1,
  ticketCount: 2,
};
const order = {
  id: 'order-1',
  eventId: 'event-1',
  sessionId: 'session-1',
  ticketTypeId: 'ticket-type-1',
  quantity: 2,
  unitPriceCents: 2500,
  totalPriceCents: 5000,
  currency: 'EUR',
  status: 'CONFIRMED',
  invoiceNumber: null,
  invoicedAt: null,
  refundedAt: null,
  cancelledAt: null,
  event: { key: 'wine-night', name: 'Soirée dégustation' },
  session: { startsAt: session.startsAt, endsAt: session.endsAt },
  ticketType: { key: 'standard', name: 'Entrée standard', priceCents: 2500, currency: 'EUR' },
  customerName: 'Alice Martin',
  phoneLast4: '1234',
  ticketCount: 2,
};
const ticket = {
  id: 'ticket-1',
  eventId: 'event-1',
  sessionId: 'session-1',
  orderId: 'order-1',
  ticketTypeId: 'ticket-type-1',
  codeLast4: 'ABCD',
  status: 'ISSUED',
  checkedInAt: null,
  event: { key: 'wine-night', name: 'Soirée dégustation' },
  session: { startsAt: session.startsAt, endsAt: session.endsAt },
  ticketType: { key: 'standard', name: 'Entrée standard' },
  customerName: 'Alice Martin',
  phoneLast4: '1234',
};

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/dashboard/events');
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('events?')) return Promise.resolve({ data: [event] });
      if (path.startsWith('event-orders')) return Promise.resolve({ data: [order] });
      if (path.startsWith('event-tickets')) return Promise.resolve({ data: [ticket] });
      if (path.includes('/sessions')) return Promise.resolve({ data: [session] });
      if (path.includes('/ticket-types')) return Promise.resolve({ data: [ticketType] });
      return Promise.resolve({ data: [] });
    });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'events') return Promise.resolve({ data: event });
      if (path.includes('/orders'))
        return Promise.resolve({ data: { ...order, ticketCodes: ['00000000ABCD'] } });
      if (path.includes('/check-in'))
        return Promise.resolve({ data: { ...ticket, status: 'CHECKED_IN' } });
      return Promise.resolve({ data: session });
    });
    apiMocks.patch.mockResolvedValue({ data: { ...event, status: 'DRAFT' } });
  });

  it('charge les événements, sessions, tarifs et billets', async () => {
    render(<EventsPage />);
    expect(await screen.findByRole('heading', { name: 'Événements' })).toBeInTheDocument();
    expect((await screen.findAllByText('Soirée dégustation')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Alice Martin/)).toBeInTheDocument();
    expect(screen.getByText('Dates ouvertes')).toBeInTheDocument();
  });

  it('crée un événement depuis un formulaire dédié et génère sa clé depuis le nom', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    await screen.findByText('Dates ouvertes');
    expect(screen.queryByLabelText('Nom de l’événement')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer un événement' }));
    fireEvent.change(await screen.findByLabelText('Nom de l’événement'), {
      target: { value: 'Atelier vins' },
    });
    expect(screen.queryByLabelText('Clé')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('events', {
        key: 'atelier-vins',
        name: 'Atelier vins',
      }),
    );
    expect(await screen.findByText(/Ajoutez maintenant une première date/)).toBeInTheDocument();
  });

  it('ouvre directement le formulaire quand le choix global demande un nouvel événement', async () => {
    window.history.replaceState({}, '', '/dashboard/events?create=1');
    render(<EventsPage />);
    expect(await screen.findByRole('heading', { name: 'Nouvel événement' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('affiche un seul état vide avant la première création', async () => {
    apiMocks.get.mockResolvedValue({ data: [] });
    render(<EventsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Créez votre premier événement' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aucun événement.')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucun événement pour le moment')).not.toBeInTheDocument();
  });

  it('convertit le prix du tarif en euros vers les centimes de l’API', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un tarif' }));
    fireEvent.change(await screen.findByLabelText('Nom du tarif'), {
      target: { value: 'Tarif enfant' },
    });
    fireEvent.change(screen.getByLabelText('Prix du billet'), { target: { value: '25,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le tarif' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('events/event-1/ticket-types', {
        key: 'tarif-enfant',
        name: 'Tarif enfant',
        priceCents: 2550,
        maxPerOrder: 10,
      }),
    );
  });

  it('émet une commande et affiche les codes une seule fois', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    await screen.findByText('Dates ouvertes');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: 'session-1' } });
    fireEvent.change(screen.getByLabelText('Tarif'), { target: { value: 'ticket-type-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la commande' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'events/event-1/sessions/session-1/orders',
        expect.objectContaining({ ticketTypeId: 'ticket-type-1', quantity: 1 }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
        }),
      ),
    );
    expect(await screen.findByText(/Billets à remettre/)).toBeInTheDocument();
  });

  it('contrôle un billet depuis le code saisi', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    await screen.findByText('Dates ouvertes');
    fireEvent.change(screen.getByPlaceholderText('Code du billet'), {
      target: { value: '00000000ABCD' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Contrôler' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('event-tickets/check-in', {
        code: '00000000ABCD',
      }),
    );
    expect(await screen.findByText('Billet contrôlé.')).toBeInTheDocument();
  });

  it('explique le verrouillage quand la fondation est désactivée', async () => {
    apiMocks.get.mockRejectedValue(new Error('EVENTS_DISABLED'));
    render(<EventsPage />);
    expect(await screen.findByText('EVENTS_DISABLED')).toBeInTheDocument();
    expect(
      screen.getByText('Le paiement et la vente en ligne seront disponibles prochainement.'),
    ).toBeInTheDocument();
  });
});
