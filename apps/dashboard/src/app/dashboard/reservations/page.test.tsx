import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Reservation } from '@/types/api';
import ReservationsPage from './page';

const mocks = vi.hoisted(() => ({
  orgId: 'org_test',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'r1',
    restaurantId: 'org_test',
    reservedAt: '2099-06-05T19:00:00.000Z',
    partySize: 2,
    customerName: 'Alice',
    customerPhone: null,
    status: 'CONFIRMED',
    estimatedRevenue: 70,
    tableId: null,
    table: null,
    ...overrides,
  };
}

describe('ReservationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue([]);
    mocks.post.mockResolvedValue({});
  });

  it('affiche l’état de chargement', () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ReservationsPage />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('affiche la liste vide', async () => {
    mocks.get.mockResolvedValue([]);
    render(<ReservationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Aucune réservation pour le moment')).toBeInTheDocument();
    });
  });

  it('affiche le badge Sans table et le bouton Allouer quand tableId est null', async () => {
    mocks.get.mockResolvedValue([makeReservation()]);
    render(<ReservationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Sans table')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Allouer' })).toBeInTheDocument();
  });

  it('affiche le nom de la table quand tableId est renseigné', async () => {
    mocks.get.mockResolvedValue([
      makeReservation({ tableId: 't1', table: { name: 'Terrasse 1' } }),
    ]);
    render(<ReservationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Terrasse 1')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sans table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allouer' })).not.toBeInTheDocument();
  });

  it('cliquer sur Allouer appelle le endpoint et met à jour la ligne', async () => {
    mocks.get.mockResolvedValue([makeReservation()]);
    const updated = makeReservation({ tableId: 't1', table: { name: 'Terrasse 1' } });
    mocks.post.mockResolvedValue(updated);
    render(<ReservationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Allouer' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Allouer' }));

    await waitFor(() => {
      expect(screen.getByText('Terrasse 1')).toBeInTheDocument();
    });
    expect(mocks.post).toHaveBeenCalledWith('reservations/r1/allocate-table');
    expect(screen.queryByText('Sans table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allouer' })).not.toBeInTheDocument();
  });

  it("n'affiche pas le badge Sans table ni le bouton Allouer quand le statut n'est pas actif", async () => {
    mocks.get.mockResolvedValue([makeReservation({ status: 'CANCELLED' })]);
    render(<ReservationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Annulée')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sans table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allouer' })).not.toBeInTheDocument();
  });
});
