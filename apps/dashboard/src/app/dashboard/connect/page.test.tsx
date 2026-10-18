import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toApiError } from '@/lib/api-error';
import ConnectDashboardPage from './page';

const mocks = vi.hoisted(() => ({
  orgId: 'org_test',
  siteId: 'org_test',
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ useApi: () => mocks }));
vi.mock('@/features/onboarding/onboarding-guard', () => ({ OnboardingLockBanner: () => null }));

const SETTINGS = {
  restaurantId: 'org_test',
  slug: 'le-bistrot',
  name: 'Le Bistrot',
  connectPublished: false,
  connectAgentic: false,
  connectPublishedAt: null,
  pageUrl: 'https://sokar.tech/restaurant/le-bistrot',
  customDomain: null,
  customDomainStatus: null,
};
const SCORE = {
  score: 50,
  level: 'progress',
  message: 'Bon début',
  items: [],
  missing: [],
  completed: 2,
  total: 4,
};

function loadSucceeds(operator: boolean) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === 'admin/access') return { allowed: operator };
    if (path === 'restaurants/org_test/connect') return SETTINGS;
    if (path === 'restaurants/org_test/connect/score') return SCORE;
    return {};
  });
}

describe('ConnectDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ne montre pas le lien des KPIs du pilote à un restaurateur', async () => {
    loadSucceeds(false);
    render(<ConnectDashboardPage />);
    await screen.findByText('Connect inactif');
    expect(screen.queryByRole('link', { name: /KPIs pilote/ })).not.toBeInTheDocument();
  });

  it('montre le lien des KPIs du pilote à l’équipe Sokar', async () => {
    loadSucceeds(true);
    render(<ConnectDashboardPage />);
    expect(await screen.findByRole('link', { name: /KPIs pilote/ })).toHaveAttribute(
      'href',
      '/dashboard/connect/pilot',
    );
  });

  it('explique quoi faire quand l’adresse publique manque, au lieu d’« Erreur 409 »', async () => {
    loadSucceeds(false);
    mocks.patch.mockRejectedValue(
      toApiError(409, { code: 'CONNECT_SLUG_REQUIRED', missing: ['slug'] }),
    );
    render(<ConnectDashboardPage />);

    fireEvent.click(await screen.findByRole('button', { name: /activer connect/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Choisissez d’abord l’adresse publique de votre page');
    expect(alert).not.toHaveTextContent('409');
  });

  it('propose de réessayer quand le chargement échoue, avec un message en français', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === 'admin/access') return { allowed: false };
      throw toApiError(404, { error: 'Restaurant not found' });
    });
    render(<ConnectDashboardPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('Restaurant not found');
    expect(alert).toHaveTextContent('Élément introuvable');
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('restaurants/org_test/connect');
    });
  });

  it('range sous-domaine et domaine personnalisé dans la colonne de gauche, avec l’aperçu à droite', async () => {
    loadSucceeds(false);
    render(<ConnectDashboardPage />);
    await screen.findByText('Connect inactif');

    const column = screen.getByText('Découverte IA').closest('div.space-y-4');
    expect(column).not.toBeNull();
    expect(column).toContainElement(screen.getByText('Sous-domaine gratuit'));
    expect(column).toContainElement(screen.getByText('Domaine personnalisé'));
    expect(column).not.toContainElement(screen.getByText('Aperçu en direct'));
  });
});
