import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarketingSegmentsPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    del: apiMocks.del,
    orgId: apiMocks.orgId,
  }),
}));

const segment = {
  id: 'segment-1',
  name: 'Habitués',
  definition: {
    version: 1,
    operator: 'AND',
    conditions: [{ field: 'honored365d', op: 'GTE', value: 3 }],
  },
  isSystem: false,
  lastCount: 12,
  lastEvaluatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('MarketingSegmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
    apiMocks.get.mockResolvedValue({ data: [segment] });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'marketing/segments/preview') {
        return Promise.resolve({
          count: 8,
          sample: [{ id: 'customer-1', name: 'Alice Martin', isVip: true }],
        });
      }
      if (path === 'marketing/segments') return Promise.resolve({ data: segment });
      return Promise.resolve({ data: { segment: { ...segment, lastCount: 8 } } });
    });
    apiMocks.del.mockResolvedValue({ data: { deleted: true } });
  });

  it('charge les segments et envoie une définition bornée au preview', async () => {
    render(<MarketingSegmentsPage />);

    expect(await screen.findByRole('heading', { name: 'Segments Pro' })).toBeInTheDocument();
    expect(screen.getAllByText('Habitués').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByDisplayValue('Clients fidèles'), {
      target: { value: 'VIP actifs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/segments/preview', {
        definition: {
          version: 1,
          operator: 'AND',
          conditions: [{ field: 'honored365d', op: 'GTE', value: 1 }],
        },
        sampleLimit: 5,
      }),
    );
    expect(await screen.findByText('8 profil(s) correspondent')).toBeInTheDocument();
    expect(screen.getByText(/Règles : Visites honorées \(365 j\)/)).toBeInTheDocument();
  });

  it('enregistre le segment après sa prévisualisation', async () => {
    render(<MarketingSegmentsPage />);
    await screen.findByText('Habitués');

    fireEvent.change(screen.getByDisplayValue('Clients fidèles'), {
      target: { value: 'VIP actifs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/segments', {
        name: 'VIP actifs',
        definition: {
          version: 1,
          operator: 'AND',
          conditions: [{ field: 'honored365d', op: 'GTE', value: 1 }],
        },
      }),
    );
    expect(await screen.findByText('Segment enregistré.')).toBeInTheDocument();
  });

  it('charge un modèle système sans contourner la validation API', async () => {
    render(<MarketingSegmentsPage />);
    await screen.findByText('Habitués');

    fireEvent.click(screen.getByRole('button', { name: /^VIP manuels/ }));
    expect(screen.getByDisplayValue('VIP manuels')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Champ condition 1' })).toHaveValue('isVip');
    expect(screen.getByText('Modèle « VIP manuels » chargé.')).toBeInTheDocument();
  });

  it('explique le refus Essential', async () => {
    apiMocks.get.mockRejectedValue(new Error('CAPABILITY_NOT_INCLUDED'));
    render(<MarketingSegmentsPage />);

    expect(await screen.findByText('CAPABILITY_NOT_INCLUDED')).toBeInTheDocument();
    expect(screen.getByText('Les segments sont inclus dans la formule Pro.')).toBeInTheDocument();
  });
});
