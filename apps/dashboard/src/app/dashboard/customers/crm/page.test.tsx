import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  visitCount: 8,
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
    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
    expect(screen.getByText('+33612345678 · alice@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Doublons à traiter/i })).toHaveAttribute(
      'href',
      '/dashboard/customers/crm/duplicates',
    );
    expect(apiMocks.get).toHaveBeenCalledWith(expect.stringContaining('crm/customers?'));
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

  it('explique le refus de formule sans masquer le fichier de base', async () => {
    apiMocks.get.mockRejectedValue(
      new Error('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    );
    render(<CrmPage />);

    expect(
      await screen.findByText(/Cette fonctionnalité n’est pas incluse dans votre formule/),
    ).toBeInTheDocument();
    expect(screen.getByText(/CRM avancé est inclus dans la formule Pro/)).toBeInTheDocument();
  });
});
