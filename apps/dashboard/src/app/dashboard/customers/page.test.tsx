import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toApiError } from '@/lib/api-error';
import CustomersPage from './page';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  orgId: 'org_test',
  isMobile: false,
  activeSite: { role: 'OWNER' } as { role: string } | null,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => mocks.isMobile,
}));

vi.mock('@/features/sites/site-context', () => ({
  useSiteSelection: () => ({ activeSite: mocks.activeSite }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isMobile = false;
    mocks.activeSite = { role: 'OWNER' };
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

  it('affiche les visites sur 365 jours et la dernière vraie visite, jamais le compteur hérité', async () => {
    // CRM Pro ouvert : le nom mène à la fiche détaillée.
    mocks.get.mockImplementation(() => Promise.resolve({ data: [] }));
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          phone: '+33600000000',
          name: 'Alice Demo',
          emailNormalized: 'alice@example.com',
          isVip: false,
          notes: null,
          lastSeenAt: '2026-10-26T12:00:00.000Z',
          lifecycle: { status: 'active', reason: '2 visites' },
          visitSummary: {
            visits: 4,
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
    expect(row).toHaveTextContent('alice@example.com');
    const cells = within(row).getAllByRole('cell');
    expect(cells[2]).toHaveTextContent(/^2$/); // visites sur 365 jours
    expect(row).not.toHaveTextContent('9');
    expect(row).toHaveTextContent('14 août 2026');
    expect(row).not.toHaveTextContent('26 oct');
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
    expect(screen.getByRole('heading', { name: /Clients\s*1$/ })).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole('button', { name: 'Marquer VIP' }));

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

    expect(await screen.findByRole('button', { name: 'Marquer VIP' })).toBeInTheDocument();
    // Un client hors VIP n'affiche plus de pastille « Standard ».
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
    // Un lien tel: compose le numéro d'un geste (une fenêtre « Fermer » ne servait à rien).
    expect(screen.getByRole('link', { name: 'Appeler Alice Demo' })).toHaveAttribute(
      'href',
      'tel:+33600000000',
    );
  });

  it('cherche à la frappe après une pause, sans bouton Rechercher', async () => {
    mocks.get.mockResolvedValue({ data: [], total: 0 });
    render(<CustomersPage />);
    await screen.findByText('Aucun client enregistré');
    expect(screen.queryByRole('button', { name: 'Rechercher' })).not.toBeInTheDocument();

    // Un numéro saisi à la française est transmis tel quel à l’API.
    fireEvent.change(screen.getByRole('textbox', { name: /rechercher un client/i }), {
      target: { value: '06 12 34 56 78' },
    });

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

    expect(await screen.findByRole('heading', { name: /Clients\s*3$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /afficher plus de clients \(2 sur 3\)/i }));

    expect(await screen.findByText('Client 03')).toBeInTheDocument();
    // CRM capability checks can finish after pagination; only customer-list request order matters.
    expect(mocks.get.mock.calls.filter(([path]) => path.startsWith('customers?')).at(-1)).toEqual([
      'customers?limit=50&offset=2',
    ]);
    expect(screen.getAllByText(/^Client 0\d$/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /afficher plus/i })).not.toBeInTheDocument();
  });

  describe('CRM Pro dans l’écran Clients', () => {
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

    it('ouvre les doublons, les segments avancés et les fiches quand le CRM Pro est ouvert', async () => {
      mockCrm(() => Promise.resolve({ data: [] }));
      render(<CustomersPage />);
      expect(await screen.findByRole('link', { name: /Doublons/ })).toHaveAttribute(
        'href',
        '/dashboard/customers/crm/duplicates',
      );
      expect(screen.getByRole('tab', { name: 'Endormis' })).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Visites min. (365 j)')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Alice Demo' })).toHaveAttribute(
        'href',
        '/dashboard/customers/crm/customer-1',
      );
    });

    it('masque l’export aux responsables qui ne sont pas propriétaires', async () => {
      mocks.activeSite = { role: 'MANAGER' };
      mockCrm(() => Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' })));
      render(<CustomersPage />);
      expect(await screen.findByText(/Segments par statut/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Exporter/ })).not.toBeInTheDocument();
    });

    it('exporte le fichier clients en CSV, sur toutes les formules', async () => {
      mockCrm(() => Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' })));
      mocks.get.mockImplementation((path: string) =>
        path === 'customers/export'
          ? Promise.resolve({ data: { csv: 'Nom;Téléphone\r\n', count: 1 } })
          : path.startsWith('crm/')
            ? Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }))
            : Promise.resolve(one),
      );
      const createObjectURL = vi.fn(() => 'blob:csv');
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      render(<CustomersPage />);
      fireEvent.click(await screen.findByRole('button', { name: /Exporter/ }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(mocks.get).toHaveBeenCalledWith('customers/export');
      expect(click).toHaveBeenCalled();
      click.mockRestore();
    });

    it('hors formule : CRM de base, avec les segments avancés présentés comme inclus dans CRM Pro', async () => {
      mockCrm(() => Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' })));
      render(<CustomersPage />);
      expect(await screen.findByText(/Segments par statut/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voir les formules' })).toHaveAttribute(
        'href',
        '/pricing',
      );
      expect(screen.queryByRole('tab', { name: 'Endormis' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Doublons/ })).not.toBeInTheDocument();
      // La fiche simple (historique, allergies, préférences) s'ouvre dès Essential.
      expect(screen.getByRole('link', { name: 'Alice Demo' })).toHaveAttribute(
        'href',
        '/dashboard/customers/crm/customer-1',
      );
      expect(screen.getByRole('tab', { name: 'VIP' })).toBeInTheDocument();
    });

    it('cache tout le CRM Pro quand il est fermé', async () => {
      mockCrm(() => Promise.reject(toApiError(503, { error: 'CRM_ADVANCED_DISABLED' })));
      render(<CustomersPage />);
      await screen.findByText('Alice Demo');
      await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('crm/customers?limit=1'));
      expect(screen.queryByRole('link', { name: /Doublons/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/CRM Pro/)).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Endormis' })).not.toBeInTheDocument();
    });

    it('filtre par segment puis par visites côté serveur, sans bouton de validation', async () => {
      mockCrm(() => Promise.resolve({ data: [] }));
      render(<CustomersPage />);
      fireEvent.click(await screen.findByRole('tab', { name: 'Endormis' }));

      await waitFor(() =>
        expect(mocks.get).toHaveBeenCalledWith('customers?limit=50&offset=0&lifecycle=dormant'),
      );

      fireEvent.change(screen.getByPlaceholderText('Visites min. (365 j)'), {
        target: { value: '3' },
      });
      await waitFor(() =>
        expect(mocks.get).toHaveBeenCalledWith(
          'customers?limit=50&offset=0&lifecycle=dormant&minHonored365d=3',
        ),
      );
    });

    it('garde la recherche en cours quand on change de segment', async () => {
      mockCrm(() => Promise.resolve({ data: [] }));
      render(<CustomersPage />);
      await screen.findByRole('tab', { name: 'Endormis' });

      fireEvent.change(screen.getByRole('textbox', { name: /rechercher un client/i }), {
        target: { value: 'Alice' },
      });
      fireEvent.click(screen.getByRole('tab', { name: 'VIP' }));

      await waitFor(() =>
        expect(mocks.get).toHaveBeenLastCalledWith(
          'customers?limit=50&offset=0&search=Alice&isVip=true',
        ),
      );
    });

    it('filtre sur le VIP quelle que soit la formule', async () => {
      mockCrm(() => Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' })));
      render(<CustomersPage />);
      fireEvent.click(await screen.findByRole('tab', { name: 'VIP' }));
      await waitFor(() =>
        expect(mocks.get).toHaveBeenCalledWith('customers?limit=50&offset=0&isVip=true'),
      );
    });

    it('ouvre la fiche au clic sur la ligne, quand le CRM Pro est ouvert', async () => {
      mockCrm(() => Promise.resolve({ data: [] }));
      render(<CustomersPage />);
      await screen.findByRole('link', { name: /Doublons/ });
      fireEvent.click(screen.getAllByText('+33 6 00 00 00 00')[0]);
      expect(mocks.push).toHaveBeenCalledWith('/dashboard/customers/crm/customer-1');
    });

    it('affiche un compteur sur chaque segment quand le CRM Pro est ouvert', async () => {
      mocks.get.mockImplementation((path: string) => {
        if (path.startsWith('crm/')) return Promise.resolve({ data: [] });
        if (path.startsWith('customers/segment-counts')) {
          return Promise.resolve({
            data: { all: 12, vip: 3, new: 2, active: 5, regular: 4, at_risk: 1, dormant: 0 },
          });
        }
        return Promise.resolve(one);
      });
      render(<CustomersPage />);
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: /VIP/ })).toHaveTextContent(/VIP\s*3/),
      );
      // L'onglet actif garde le total de la liste, qui suit aussi « Visites min. ».
      expect(screen.getByRole('tab', { name: /Tous/ })).toHaveTextContent(/Tous\s*1$/);
      expect(screen.getByRole('tab', { name: /Habitués/ })).toHaveTextContent(/Habitués\s*4/);
      expect(screen.getByRole('tab', { name: /À risque/ })).toHaveTextContent(/À risque\s*1/);
      expect(screen.getByRole('tab', { name: /Endormis/ })).toHaveTextContent(/Endormis\s*0/);
      expect(screen.getByRole('tab', { name: /Nouveaux/ })).toHaveTextContent(/Nouveaux\s*2/);
    });

    it('trie par visites 365 j au clic sur l’en-tête, puis revient au tri récent', async () => {
      mockCrm(() => Promise.resolve({ data: [] }));
      render(<CustomersPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Visites 365 j' }));
      await waitFor(() =>
        expect(mocks.get).toHaveBeenLastCalledWith('customers?limit=50&offset=0&sort=visits365d'),
      );
      await waitFor(() =>
        expect(screen.getByRole('columnheader', { name: /Visites 365 j/ })).toHaveAttribute(
          'aria-sort',
          'descending',
        ),
      );
      expect(screen.getByRole('columnheader', { name: /Dernière visite/ })).not.toHaveAttribute(
        'aria-sort',
      );

      fireEvent.click(screen.getByRole('button', { name: 'Visites 365 j' }));
      await waitFor(() =>
        expect(mocks.get).toHaveBeenLastCalledWith('customers?limit=50&offset=0'),
      );
      await waitFor(() =>
        expect(screen.getByRole('columnheader', { name: /Visites 365 j/ })).not.toHaveAttribute(
          'aria-sort',
        ),
      );
    });

    it('ne demande pas les compteurs quand le CRM Pro est fermé', async () => {
      mockCrm(() => Promise.reject(toApiError(503, { error: 'CRM_ADVANCED_DISABLED' })));
      render(<CustomersPage />);
      await screen.findByText('Alice Demo');
      await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('crm/customers?limit=1'));
      expect(
        mocks.get.mock.calls.some(([path]) => String(path).startsWith('customers/segment-counts')),
      ).toBe(false);
    });
  });
});
