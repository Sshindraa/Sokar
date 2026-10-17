import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
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
    apiMocks.get.mockRejectedValue(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<MarketingSegmentsPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('CAPABILITY_NOT_INCLUDED')).toBeNull();
    expect(screen.getByText('Les segments sont inclus dans la formule Pro.')).toBeInTheDocument();
  });

  it('demande confirmation avant de supprimer un segment', async () => {
    render(<MarketingSegmentsPage />);
    await screen.findByText('Habitués');

    fireEvent.click(screen.getByRole('button', { name: /Supprimer$/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Supprimer le segment « Habitués » ?');
    expect(dialog).toHaveTextContent('Vos clients ne sont pas supprimés');
    expect(apiMocks.del).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(apiMocks.del).toHaveBeenCalledWith('marketing/segments/segment-1'));
  });

  it('affiche les opérateurs en français', async () => {
    render(<MarketingSegmentsPage />);
    await screen.findByText('Habitués');

    expect(screen.getAllByText('Toutes (ET)').some((element) => element.tagName !== 'OPTION')).toBe(
      true,
    );
    expect(screen.queryByText('AND')).toBeNull();
  });

  it('nomme la préférence « Langue préférée » plutôt que sa clé technique', async () => {
    apiMocks.get.mockResolvedValue({
      data: [
        {
          ...segment,
          id: 'segment-2',
          name: 'Langue renseignée',
          definition: {
            version: 1,
            operator: 'OR',
            conditions: [{ field: 'preference', op: 'EXISTS', value: 'preferred_language' }],
          },
        },
      ],
    });
    render(<MarketingSegmentsPage />);

    expect(await screen.findByText(/Préférence existe Langue préférée/)).toBeInTheDocument();
    expect(screen.queryByText(/preferred_language/)).toBeNull();
    expect(
      screen.getAllByText('Au moins une (OU)').some((element) => element.tagName !== 'OPTION'),
    ).toBe(true);
  });
});
