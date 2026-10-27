import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import CrmPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, orgId: apiMocks.orgId }),
}));

const customer = {
  id: 'customer-1',
  name: 'Alice Martin',
  phone: '+33612345678',
  emailNormalized: 'alice@example.com',
  isVip: true,
  updatedAt: new Date().toISOString(),
  metricSnapshot: {
    honored365d: 6,
    cancelled365d: 1,
    noShow365d: 0,
    covers365d: 12,
    actualLifetimeSpend: null,
    lastHonoredAt: new Date().toISOString(),
  },
};

describe('CrmPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
    apiMocks.get.mockResolvedValue({ data: [customer], nextCursor: null });
  });

  it('affiche les profils enrichis et le lien vers les doublons', async () => {
    render(<CrmPage />);

    expect(await screen.findByRole('heading', { name: 'CRM Pro' })).toBeInTheDocument();
    expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
    expect(await screen.findByText('+33612345678 · alice@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Doublons à traiter/i })).toHaveAttribute(
      'href',
      '/dashboard/customers/crm/duplicates',
    );
    expect(apiMocks.get).toHaveBeenCalledWith(expect.stringContaining('crm/customers?'));
  });

  it('filtre par statut côté serveur et affiche les vraies visites', async () => {
    apiMocks.get.mockResolvedValue({
      data: [
        {
          ...customer,
          lifecycle: { status: 'at_risk', reason: 'Dernière visite il y a 3 mois' },
          visitSummary: { visits: 4, visits365d: 3, noShows365d: 1, lastVisitAt: null },
        },
      ],
      nextCursor: null,
    });
    render(<CrmPage />);
    await screen.findByText('Alice Martin');

    fireEvent.change(screen.getByLabelText('Filtre statut'), { target: { value: 'at_risk' } });

    await waitFor(() =>
      expect(apiMocks.get).toHaveBeenLastCalledWith(expect.stringContaining('lifecycle=at_risk')),
    );
    const row = screen.getByText('Alice Martin').closest('tr')!;
    expect(row).toHaveTextContent('À risque');
    expect(row).toHaveTextContent('3 visite(s) · 1 no-show');
    // Le compteur hérité (8) et la projection (6 honorées) ne sont plus affichés.
    expect(row.querySelectorAll('td')[1]).toHaveTextContent(/^4$/);
    expect(row).not.toHaveTextContent('6 honorée');
  });

  it('envoie les filtres saisis au serveur', async () => {
    render(<CrmPage />);
    await screen.findByText('Alice Martin');

    fireEvent.change(screen.getByPlaceholderText('Nom, téléphone ou email'), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByPlaceholderText('Visites min. (365 j)'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));

    await waitFor(() =>
      expect(apiMocks.get).toHaveBeenLastCalledWith(
        expect.stringContaining('search=Alice&minHonored365d=3'),
      ),
    );
  });

  it('explique le refus de formule, sans « Réessayer » inutile, et ramène aux clients', async () => {
    apiMocks.get.mockRejectedValue(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<CrmPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /réessayer/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Retour aux clients/ })).toHaveAttribute(
      'href',
      '/dashboard/customers',
    );
  });

  it('traite un CRM pas encore ouvert comme un état normal, pas comme une panne', async () => {
    apiMocks.get.mockRejectedValue(toApiError(503, { error: 'CRM_ADVANCED_DISABLED' }));
    render(<CrmPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas encore ouverte sur votre compte.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /réessayer/i })).toBeNull();
  });

  it('propose de réessayer pour une vraie panne', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<CrmPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
  });

  it('ne recharge la liste qu’au clic sur Rechercher, pas à chaque frappe', async () => {
    render(<CrmPage />);
    await screen.findByText('Alice Martin');
    const callsBefore = apiMocks.get.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText('Nom, téléphone ou email'), {
      target: { value: 'Ali' },
    });
    fireEvent.change(screen.getByPlaceholderText('Nom, téléphone ou email'), {
      target: { value: 'Alice' },
    });

    expect(apiMocks.get.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
  });

  it('distingue « aucun profil » de « aucun résultat pour ces filtres »', async () => {
    apiMocks.get.mockResolvedValue({ data: [], nextCursor: null });
    render(<CrmPage />);
    expect(await screen.findByText('Aucun profil CRM pour le moment')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Nom, téléphone ou email'), {
      target: { value: 'zzz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(await screen.findByText('Aucun profil ne correspond à ces filtres')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Effacer les filtres' })).toBeInTheDocument();
  });
});
