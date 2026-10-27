import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toApiError } from '@/lib/api-error';
import CustomersPage from './page';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  orgId: 'org_test',
  isMobile: false,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => mocks.isMobile,
}));

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isMobile = false;
    // Par défaut le CRM avancé est fermé : la sonde du bouton « CRM Pro » ne doit pas perturber les tests.
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('crm/')
        ? Promise.reject(toApiError(503, { error: 'CRM_ADVANCED_DISABLED' }))
        : Promise.resolve({ data: [] }),
    );
  });

  function customerCalls() {
    return mocks.get.mock.calls.filter(([path]) => String(path).startsWith('customers'));
  }

  it('propose un nouvel essai sans afficher une liste vide après une panne API', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('Impossible de joindre le serveur API'))
      .mockResolvedValueOnce({ data: [] });

    render(<CustomersPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impossible de joindre le serveur API');
    expect(screen.queryByText('Aucun client enregistré')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucun client enregistré')).toBeInTheDocument();
    });
    expect(customerCalls()).toHaveLength(2);
  });

  it('affiche les visites honorées et la dernière vraie visite, jamais le compteur hérité', async () => {
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          phone: '+33600000000',
          name: 'Alice Demo',
          isVip: false,
          notes: null,
          lastSeenAt: '2026-10-26T12:00:00.000Z',
          lifecycle: { status: 'active', reason: '2 visites' },
          visitSummary: {
            visits: 2,
            visits365d: 2,
            noShows365d: 0,
            lastVisitAt: '2026-08-14T19:00:00.000Z',
          },
        },
      ],
      total: 1,
    });

    render(<CustomersPage />);

    const link = await screen.findByRole('link', { name: 'Alice Demo' });
    expect(link).toHaveAttribute('href', '/dashboard/customers/crm/customer-1');
    const row = link.closest('tr')!;
    expect(row).toHaveTextContent('2');
    expect(row).not.toHaveTextContent('9');
    expect(row).toHaveTextContent('14/08/2026');
    expect(row).not.toHaveTextContent('26/10/2026');
  });

  it('affiche les clients renvoyés dans l’enveloppe API data', async () => {
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          restaurantId: 'org_test',
          phone: '+33600000000',
          name: 'Alice Demo',
          isVip: false,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<CustomersPage />);

    expect(await screen.findByText('Alice Demo')).toBeInTheDocument();
    expect(screen.getByText('1 client')).toBeInTheDocument();
    expect(screen.queryByText('Aucun client enregistré')).not.toBeInTheDocument();
  });

  it('utilise la route POST de bascule VIP exposée par l’API', async () => {
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          restaurantId: 'org_test',
          phone: '+33600000000',
          name: 'Alice Demo',
          isVip: false,
        },
      ],
    });
    mocks.post.mockResolvedValueOnce({ isVip: true });

    render(<CustomersPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('customers/customer-1/vip', { isVip: true });
    });
  });

  it('présente une carte mobile stable avec des actions explicites', async () => {
    mocks.isMobile = true;
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          restaurantId: 'org_test',
          phone: '+33600000000',
          name: 'Alice Demo',
          isVip: false,
          lastSeenAt: null,
          notes: null,
        },
      ],
    });

    render(<CustomersPage />);

    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marquer VIP' })).toBeInTheDocument();
    // Un lien tel: compose le numéro d'un geste (une fenêtre « Fermer » ne servait à rien).
    expect(screen.getByRole('link', { name: 'Appeler Alice Demo' })).toHaveAttribute(
      'href',
      'tel:+33600000000',
    );
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });

  it('cherche avec un numéro saisi à la française et le transmet tel quel à l’API', async () => {
    mocks.get.mockResolvedValue({ data: [], total: 0 });
    render(<CustomersPage />);
    await screen.findByText('Aucun client enregistré');

    fireEvent.change(screen.getByRole('textbox', { name: /rechercher un client/i }), {
      target: { value: '06 12 34 56 78' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));

    await waitFor(() => {
      expect(mocks.get).toHaveBeenLastCalledWith(
        'customers?limit=50&offset=0&search=06+12+34+56+78',
      );
    });
    expect(
      await screen.findByText('Aucun client ne correspond à cette recherche'),
    ).toBeInTheDocument();
  });

  it('charge la suite de la liste et annonce le vrai total', async () => {
    const make = (id: string) => ({
      id,
      restaurantId: 'org_test',
      phone: `+3360000${id}`,
      name: `Client ${id}`,
      isVip: false,
      lastSeenAt: null,
      notes: null,
    });
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('crm/')) {
        return Promise.reject(toApiError(503, { error: 'CRM_ADVANCED_DISABLED' }));
      }
      return Promise.resolve(
        path.includes('offset=0')
          ? { data: [make('01'), make('02')], total: 3 }
          : { data: [make('02'), make('03')], total: 3 },
      );
    });

    render(<CustomersPage />);

    expect(await screen.findByText('3 clients')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /afficher plus de clients \(2 sur 3\)/i }));

    expect(await screen.findByText('Client 03')).toBeInTheDocument();
    // CRM capability checks can finish after pagination; only customer-list request order matters.
    expect(mocks.get.mock.calls.filter(([path]) => path.startsWith('customers?')).at(-1)).toEqual([
      'customers?limit=50&offset=2',
    ]);
    expect(screen.getAllByText(/^Client 0\d$/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /afficher plus/i })).not.toBeInTheDocument();
  });

  describe('bouton CRM Pro', () => {
    const one = {
      data: [
        {
          id: 'customer-1',
          restaurantId: 'org_test',
          phone: '+33600000000',
          name: 'Alice Demo',
          isVip: false,
          lastSeenAt: null,
          notes: null,
        },
      ],
      total: 1,
    };

    function mockCrm(probe: () => Promise<unknown>) {
      mocks.get.mockImplementation((path: string) =>
        path.startsWith('crm/') ? probe() : Promise.resolve(one),
      );
    }

    it('apparaît quand le CRM avancé est ouvert', async () => {
      mockCrm(() => Promise.resolve({ data: [] }));
      render(<CustomersPage />);
      expect(await screen.findByRole('link', { name: /CRM Pro/ })).toHaveAttribute(
        'href',
        '/dashboard/customers/crm',
      );
    });

    it('apparaît hors formule, pour que la page CRM explique la formule', async () => {
      mockCrm(() => Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' })));
      render(<CustomersPage />);
      expect(await screen.findByRole('link', { name: /CRM Pro/ })).toBeInTheDocument();
    });

    it('reste caché quand le CRM avancé est fermé', async () => {
      mockCrm(() => Promise.reject(toApiError(503, { error: 'CRM_ADVANCED_DISABLED' })));
      render(<CustomersPage />);
      await screen.findByText('Alice Demo');
      await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('crm/customers?limit=1'));
      expect(screen.queryByRole('link', { name: /CRM Pro/ })).not.toBeInTheDocument();
    });
  });
});
