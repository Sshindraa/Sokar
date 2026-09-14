import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(await screen.findByText('Deux profils rapprochés')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Garder ce profil' })[0]);
    expect(await screen.findByText('Préférences en conflit')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Résolution preferred_language' }), {
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
    expect(await screen.findByText(/Fusion confirmée/)).toBeInTheDocument();
  });

  it('signale une erreur de formule sans lancer la lecture des profils', async () => {
    apiMocks.get.mockRejectedValue(new Error('CAPABILITY_NOT_INCLUDED'));
    render(<CustomerDuplicatesPage />);
    expect(await screen.findByText('CAPABILITY_NOT_INCLUDED')).toBeInTheDocument();
    expect(
      screen.getByText(/détection et la fusion sont incluses dans le CRM Pro/),
    ).toBeInTheDocument();
  });
});
