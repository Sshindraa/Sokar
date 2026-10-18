import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import CustomerDuplicatesPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, post: apiMocks.post, orgId: apiMocks.orgId }),
}));

const candidate = {
  id: 'customer-a:customer-b',
  score: 90,
  reasons: [
    { code: 'PHONE_MATCH', points: 80, label: 'Téléphone normalisé identique' },
    { code: 'NAME_MATCH', points: 10, label: 'Nom normalisé identique' },
  ],
  left: {
    id: 'customer-a',
    name: 'Alice Martin',
    phone: '+33612345678',
    emailNormalized: null,
    visitCount: 5,
    isVip: true,
  },
  right: {
    id: 'customer-b',
    name: 'Alice Martin',
    phone: '+33612345678',
    emailNormalized: null,
    visitCount: 2,
    isVip: false,
  },
};

const preview = {
  target: { ...candidate.left, notes: null },
  sources: [{ ...candidate.right, notes: null }],
  conflicts: {
    identities: [
      { type: 'PHONE', normalizedValue: '+33612345678', customerIds: ['customer-a', 'customer-b'] },
    ],
    preferences: [
      {
        key: 'preferred_language',
        values: [
          { customerId: 'customer-a', value: 'fr', updatedAt: '2026-09-10T00:00:00.000Z' },
          { customerId: 'customer-b', value: 'en', updatedAt: '2026-09-11T00:00:00.000Z' },
        ],
        resolutionRequired: true,
      },
    ],
    profileFields: [],
    permissions: [],
    campaignAudience: [],
  },
  impact: {
    reservations: 2,
    giftCards: 0,
    timelineEvents: 4,
    identities: 0,
    preferences: 2,
    tags: 1,
    permissions: 0,
    marketingMessages: 0,
    conversions: 0,
  },
};

describe('CustomerDuplicatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
    apiMocks.get.mockResolvedValue({ data: [candidate], nextCursor: null });
    apiMocks.post.mockImplementation((path: string) => {
      if (path.includes('merge-preview')) return Promise.resolve({ data: preview });
      return Promise.resolve({
        data: {
          auditId: 'audit-1',
          targetCustomerId: 'customer-a',
          sourceCustomerIds: ['customer-b'],
          replayed: false,
        },
      });
    });
  });

  it('prévisualise une paire, exige la résolution puis envoie une clé idempotente', async () => {
    render(<CustomerDuplicatesPage />);
    expect(await screen.findByText('Deux profils qui se ressemblent')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Garder ce profil' })[0]);
    expect(await screen.findByText('Préférences en conflit')).toBeInTheDocument();
    // Pas d'identifiant interne ni de clé technique à l'écran ; les valeurs sont attribuées à un nom.
    expect(screen.queryByText(/customer-a|customer-b|preferred_language/)).toBeNull();
    expect(screen.getByText('Langue préférée')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Valeur à garder : Langue préférée' }), {
      target: { value: 'latest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la fusion' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenLastCalledWith(
        'crm/customers/customer-a/merge',
        {
          sourceCustomerIds: ['customer-b'],
          preferenceResolution: { preferred_language: 'latest' },
        },
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    );
    expect(await screen.findByText(/Fusion effectuée/)).toBeInTheDocument();
  });

  it('signale une formule non incluse, sans « Réessayer » ni panneau de fusion vide', async () => {
    apiMocks.get.mockRejectedValue(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<CustomerDuplicatesPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('CAPABILITY_NOT_INCLUDED')).toBeNull();
    expect(screen.queryByRole('button', { name: /réessayer/i })).toBeNull();
    expect(screen.queryByText('Aperçu de fusion')).toBeNull();
  });

  it('propose de réessayer après une panne, sans panneau de fusion vide', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<CustomerDuplicatesPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
    expect(screen.queryByText('Aperçu de fusion')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findByText('Deux profils qui se ressemblent')).toBeInTheDocument();
  });

  it('traduit un refus de fusion au lieu d’afficher un code', async () => {
    apiMocks.post.mockImplementation((path: string) => {
      if (path.includes('merge-preview')) {
        return Promise.reject(toApiError(409, { error: 'CUSTOMER_NOT_ACTIVE' }));
      }
      return Promise.resolve({});
    });
    render(<CustomerDuplicatesPage />);
    await screen.findByText('Deux profils qui se ressemblent');

    fireEvent.click(screen.getAllByRole('button', { name: 'Garder ce profil' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ce profil a déjà été fusionné ou archivé. Actualisez la liste.',
    );
    expect(screen.queryByText('CUSTOMER_NOT_ACTIVE')).toBeNull();
  });

  it('amène à l’aperçu de fusion quand il s’affiche sous la liste (petits écrans)', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    try {
      render(<CustomerDuplicatesPage />);
      await screen.findByText('Deux profils qui se ressemblent');

      fireEvent.click(screen.getAllByRole('button', { name: 'Garder ce profil' })[0]);

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
