import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Reservation, WaitingListEntry } from '@/types/api';
import ReservationsPage from './page';

const mocks = vi.hoisted(() => ({
  orgId: 'org_test',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  isMobile: false,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => mocks.isMobile,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmLabel,
  }: {
    open: boolean;
    onConfirm: () => void;
    confirmLabel: string;
  }) => (open ? <button onClick={onConfirm}>{confirmLabel}</button> : null),
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

function makeWaitingListEntry(overrides: Partial<WaitingListEntry> = {}): WaitingListEntry {
  return {
    id: 'wl1',
    partySize: 3,
    customerFirstName: 'Bob',
    customerLastName: 'Dylan',
    customerPhone: '+33612345678',
    customerEmail: null,
    slotStart: '2099-06-05T19:00:00.000Z',
    slotEnd: '2099-06-05T20:30:00.000Z',
    preferredSectionName: null,
    status: 'PENDING',
    position: 1,
    createdAt: '2099-06-05T10:00:00.000Z',
    promotedReservationId: null,
    ...overrides,
  };
}

describe('ReservationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMobile = false;
    Element.prototype.scrollIntoView = vi.fn();
    mocks.get.mockResolvedValue([]);
    mocks.post.mockResolvedValue({});
    mocks.del.mockResolvedValue(undefined);
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

  it('annule une réservation via le contrat status du dashboard', async () => {
    mocks.get.mockResolvedValue([makeReservation()]);
    mocks.patch.mockResolvedValue(makeReservation({ status: 'CANCELLED', state: 'CANCELLED' }));
    render(<ReservationsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: 'Autres actions pour Alice' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Autres actions pour Alice' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Annuler' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));

    await waitFor(() => {
      expect(mocks.patch).toHaveBeenCalledWith('reservations/r1', { status: 'CANCELLED' });
      expect(screen.getByText('Annulée')).toBeInTheDocument();
    });
  });

  it('ne propose pas de transition sur un état terminal', async () => {
    mocks.get.mockResolvedValue([makeReservation({ state: 'HONORED', status: 'SEATED' })]);
    render(<ReservationsPage />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Terminer le service' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Autres actions pour Alice' }),
    ).not.toBeInTheDocument();
  });

  it('termine le service via la transition canonique et recharge la réponse serveur', async () => {
    const seated = makeReservation({ state: 'SEATED', status: 'SEATED', tableId: 't1' });
    mocks.get
      .mockResolvedValueOnce([seated])
      .mockResolvedValueOnce([
        makeReservation({ state: 'HONORED', status: 'SEATED', tableId: 't1' }),
      ]);
    mocks.patch.mockResolvedValue(undefined);
    render(<ReservationsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Terminer le service' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        'restaurants/org_test/floor-plan/reservations/r1/state',
        { state: 'HONORED' },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Terminer le service' })).not.toBeInTheDocument(),
    );
  });

  it('garde le statut et bloque une seconde action pendant une mutation échouée', async () => {
    let rejectMutation!: (reason: Error) => void;
    mocks.get.mockResolvedValue([makeReservation({ state: 'PENDING' })]);
    mocks.patch.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectMutation = reject;
      }),
    );
    render(<ReservationsPage />);
    const confirm = await screen.findByRole('button', { name: 'Confirmer' });
    fireEvent.click(confirm);
    expect(screen.getByRole('button', { name: 'En cours…' })).toBeDisabled();
    rejectMutation(new Error('Service indisponible'));
    expect(await screen.findByText('Service indisponible')).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it('donne sur mobile la même prochaine action et cache celles des états terminaux', async () => {
    mocks.isMobile = true;
    mocks.get.mockResolvedValue([
      makeReservation({ id: 'pending', state: 'PENDING', customerName: 'Alice' }),
      makeReservation({
        id: 'seated',
        state: 'SEATED',
        status: 'SEATED',
        customerName: 'Bob',
        tableId: 't1',
      }),
      makeReservation({
        id: 'honored',
        state: 'HONORED',
        status: 'SEATED',
        customerName: 'Charles',
      }),
    ]);
    render(<ReservationsPage />);
    await waitFor(() => expect(screen.getByText('Charles')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminer le service' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Afficher les actions' })).toHaveLength(2);
  });

  describe("File d'attente", () => {
    it("permet de basculer vers l'onglet File d'attente", async () => {
      mocks.get.mockResolvedValue([]);
      render(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Aucune réservation pour le moment')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /File d'attente/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Aucune entrée en file d'attente pour cette date"),
        ).toBeInTheDocument();
      });
      expect(screen.getByLabelText('Date')).toBeInTheDocument();
    });

    it('affiche les entrées et permet de proposer une table', async () => {
      const entry = makeWaitingListEntry();
      mocks.get.mockImplementation((path: string) => {
        if (path.includes('waiting-list')) return Promise.resolve([entry]);
        return Promise.resolve([]);
      });
      mocks.post.mockResolvedValue({ id: 'res1' });

      render(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /File d'attente/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /File d'attente/i }));

      await waitFor(() => {
        expect(screen.getByText('Bob Dylan')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Proposer une table' }));

      await waitFor(() => {
        expect(screen.getByText('Table proposée avec succès')).toBeInTheDocument();
      });
      expect(mocks.post).toHaveBeenCalledWith('restaurants/org_test/waiting-list/wl1/promote');
    });

    it('affiche une erreur inline si aucune table compatible', async () => {
      const entry = makeWaitingListEntry();
      mocks.get.mockImplementation((path: string) => {
        if (path.includes('waiting-list')) return Promise.resolve([entry]);
        return Promise.resolve([]);
      });
      mocks.post.mockRejectedValue(new Error('no_compatible_table'));

      render(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /File d'attente/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /File d'attente/i }));

      await waitFor(() => {
        expect(screen.getByText('Bob Dylan')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Proposer une table' }));

      await waitFor(() => {
        expect(screen.getByText('Aucune table compatible')).toBeInTheDocument();
      });
    });

    it("permet de retirer une entrée de la file d'attente", async () => {
      const entry = makeWaitingListEntry();
      mocks.get.mockImplementation((path: string) => {
        if (path.includes('waiting-list')) return Promise.resolve([entry]);
        return Promise.resolve([]);
      });

      render(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /File d'attente/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /File d'attente/i }));

      await waitFor(() => {
        expect(screen.getByText('Bob Dylan')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));

      await waitFor(() => {
        expect(screen.queryByText('Bob Dylan')).not.toBeInTheDocument();
      });
      expect(mocks.del).toHaveBeenCalledWith('restaurants/org_test/waiting-list/wl1');
    });
  });
});
