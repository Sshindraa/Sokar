import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventsPage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

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
    expect(screen.getByText('Sessions ouvertes')).toBeInTheDocument();
  });

  it('crée un événement avec la clé et le nom saisis', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    fireEvent.change(screen.getAllByLabelText('Clé')[0], { target: { value: 'atelier-vins' } });
    fireEvent.change(screen.getAllByLabelText('Nom')[0], { target: { value: 'Atelier vins' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('events', {
        key: 'atelier-vins',
        name: 'Atelier vins',
      }),
    );
    expect(await screen.findByText(/Événement créé en brouillon/)).toBeInTheDocument();
  });

  it('émet une commande et affiche les codes une seule fois', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 'session-1' } });
    fireEvent.change(screen.getByLabelText('Tarif'), { target: { value: 'ticket-type-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Émettre' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'events/event-1/sessions/session-1/orders',
        expect.objectContaining({ ticketTypeId: 'ticket-type-1', quantity: 1 }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
        }),
      ),
    );
    expect(await screen.findByText(/Codes à remettre/)).toBeInTheDocument();
  });

  it('contrôle un billet depuis le code saisi', async () => {
    render(<EventsPage />);
    await screen.findByRole('heading', { name: 'Événements' });
    fireEvent.change(screen.getByPlaceholderText('Code 12 caractères'), {
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
    expect(screen.getByText(/restent verrouillés pendant la qualification/)).toBeInTheDocument();
  });
});
