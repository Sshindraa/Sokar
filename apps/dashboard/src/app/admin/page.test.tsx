import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHomePage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get }),
}));

const readyRestaurant = {
  restaurantId: 'restaurant-ready',
  steps: {
    assignment: { completed: true, voiceAppLink: 'linked' },
    webhook: { completed: true },
    forwarding: { completed: true },
    testCall: { completed: true },
  },
};

const needsSetupRestaurant = {
  restaurantId: 'restaurant-pending',
  steps: {
    assignment: { completed: false, voiceAppLink: null },
    webhook: { completed: false },
    forwarding: { completed: false },
    testCall: { completed: false },
  },
};

const voiceLinkNeedsReview = {
  restaurantId: 'restaurant-voice-link',
  steps: {
    assignment: { completed: true, voiceAppLink: 'failed' },
    webhook: { completed: true },
    forwarding: { completed: true },
    testCall: { completed: true },
  },
};

function mockOverview(empty = false) {
  apiMocks.get.mockImplementation((path: string) => {
    if (path === 'admin/provisioning/restaurants') {
      const restaurants = empty
        ? []
        : [readyRestaurant, needsSetupRestaurant, voiceLinkNeedsReview];
      return Promise.resolve({ count: restaurants.length, restaurants });
    }
    if (path === 'admin/demo-requests/summary') {
      return Promise.resolve({
        byStatus: { NEW: empty ? 0 : 2 },
        notificationUnconfirmed: empty ? 0 : 1,
      });
    }
    if (path === 'admin/onboarding-funnel/cohort') {
      return Promise.resolve({
        funnel: { timeToFirstReservation: { pending: empty ? 0 : 1 } },
      });
    }
    if (path.startsWith('admin/usage/margin')) {
      return Promise.resolve({
        rows: empty ? [] : [{ unpricedEventCount: 3 }],
      });
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
}

describe('AdminHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOverview();
  });

  it('présente des actions précises et mène directement aux écrans concernés', async () => {
    render(<AdminHomePage />);

    expect(await screen.findByText('2 nouvelles demandes')).toBeInTheDocument();
    expect(screen.getByText(/1 notification sans confirmation/)).toBeInTheDocument();
    expect(
      screen.getByText('1 numéro · 1 webhook · 1 renvoi · 1 appel de test · 1 lien voix'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 parcours')).toBeInTheDocument();
    expect(screen.getByText('3 usages')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Demandes de démo/ })).toHaveAttribute(
      'href',
      '/admin/demo-requests',
    );
    expect(screen.getByRole('link', { name: /Mise en service/ })).toHaveAttribute(
      'href',
      '/admin/provisioning',
    );
    expect(screen.getByRole('link', { name: /Première réservation/ })).toHaveAttribute(
      'href',
      '/admin/onboarding',
    );
    expect(screen.getByRole('link', { name: /Tarifs fournisseurs/ })).toHaveAttribute(
      'href',
      '/admin/margin',
    );
    expect(screen.queryByText('Outils opérateur')).not.toBeInTheDocument();
    expect(screen.queryByText(/sujets?/)).not.toBeInTheDocument();
  });

  it('n’annonce une file vide que si toutes les sources ont répondu', async () => {
    mockOverview(true);
    render(<AdminHomePage />);

    expect(await screen.findByText('Aucune action en attente')).toBeInTheDocument();
    expect(screen.getByText(/0 établissements suivis/)).toBeInTheDocument();
  });

  it('signale les données partielles sans conclure à une file vide', async () => {
    apiMocks.get.mockImplementation((path: string) => {
      if (path === 'admin/demo-requests/summary') return Promise.reject(new Error('503'));
      if (path === 'admin/provisioning/restaurants') {
        return Promise.resolve({ count: 0, restaurants: [] });
      }
      if (path === 'admin/onboarding-funnel/cohort') {
        return Promise.resolve({ funnel: { timeToFirstReservation: { pending: 0 } } });
      }
      return Promise.resolve({ rows: [] });
    });

    render(<AdminHomePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Indisponible : Demandes de démo');
    expect(
      screen.getByText('Aucune action remontée par les sources disponibles'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aucune action en attente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualiser les données' })).toBeInTheDocument();
  });

  it('distingue une panne complète des autres états sans afficher de zéros trompeurs', async () => {
    apiMocks.get.mockRejectedValue(new Error('503'));
    render(<AdminHomePage />);

    expect(await screen.findByText('Données indisponibles')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Aucune source n’a répondu');
    expect(screen.queryByText('0 sujets')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune action en attente')).not.toBeInTheDocument();
  });
});
