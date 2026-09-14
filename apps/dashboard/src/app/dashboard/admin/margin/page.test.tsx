import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMarginPage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get }),
}));

describe('AdminMarginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockResolvedValue({
      month: '2026-09',
      priceSource: 'LOCAL_CATALOG',
      revenueStatus: 'NOT_STRIPE_RECONCILED',
      rows: [
        {
          restaurantId: 'restaurant-1',
          restaurantName: 'Chez Sokar',
          plan: 'PRO',
          catalogPriceEur: 299,
          estimatedCostEur: '12.500000',
          costStatus: 'PRICED',
          grossMarginEur: '286.500000',
          grossMarginPercent: '95.82',
        },
      ],
    });
  });

  it('affiche le coût opérationnel et la marge issue du catalogue local', async () => {
    render(<AdminMarginPage />);

    expect(await screen.findByRole('heading', { name: 'Coût opérationnel' })).toBeInTheDocument();
    expect(screen.getByText('Chez Sokar')).toBeInTheDocument();
    expect(screen.getByText('Tarifé')).toBeInTheDocument();
    expect(screen.getByText(/286,50/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe non rapproché/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Télécharger le suivi interne/ })).toHaveAttribute(
      'href',
      expect.stringMatching(
        /^\/api\/proxy\/admin\/usage\/accounting-export\.csv\?month=\d{4}-\d{2}$/,
      ),
    );
    expect(apiMocks.get).toHaveBeenCalledWith(
      expect.stringMatching(/^admin\/usage\/margin\?month=/),
    );
  });

  it('affiche les données non rapprochées sans fabriquer une marge', async () => {
    apiMocks.get.mockResolvedValue({
      month: '2026-09',
      priceSource: 'LOCAL_CATALOG',
      revenueStatus: 'NOT_STRIPE_RECONCILED',
      rows: [
        {
          restaurantId: 'restaurant-1',
          restaurantName: 'Chez Sokar',
          plan: 'PRO',
          catalogPriceEur: 299,
          estimatedCostEur: '0.000000',
          costStatus: 'UNPRICED',
          grossMarginEur: null,
          grossMarginPercent: null,
        },
      ],
    });

    render(<AdminMarginPage />);

    expect(await screen.findByText('Non tarifé')).toBeInTheDocument();
    expect(screen.getAllByText('À rapprocher').length).toBeGreaterThan(0);
  });

  it('affiche aussi un établissement sans usage comme activité nulle', async () => {
    apiMocks.get.mockResolvedValue({
      month: '2026-09',
      priceSource: 'LOCAL_CATALOG',
      revenueStatus: 'NOT_STRIPE_RECONCILED',
      rows: [
        {
          restaurantId: 'restaurant-zero',
          restaurantName: 'Le Calme',
          plan: 'PRO',
          catalogPriceEur: 299,
          estimatedCostEur: '0.000000',
          adjustedCostEur: '0.000000',
          costStatus: 'NO_USAGE',
          grossMarginEur: null,
          grossMarginPercent: null,
        },
      ],
    });

    render(<AdminMarginPage />);

    expect(await screen.findByText('Le Calme')).toBeInTheDocument();
    expect(screen.getByText('Aucun usage')).toBeInTheDocument();
    expect(screen.getAllByText(/0,00/).length).toBeGreaterThan(0);
  });

  it('affiche la file des corrections séparées du ledger', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('admin/usage/margin')) {
        return {
          month: '2026-09',
          priceSource: 'LOCAL_CATALOG',
          revenueStatus: 'NOT_STRIPE_RECONCILED',
          rows: [],
        };
      }
      return {
        data: [
          {
            id: 'adjustment-1',
            reportHash: 'a'.repeat(64),
            evidenceRef: 'vault://invoice.json',
            scopeKey: 'restaurant:rest-1',
            restaurantId: 'rest-1',
            category: 'SMS_SEGMENTS',
            provider: 'telnyx',
            unit: 'segments',
            periodStart: '2026-09-01T00:00:00.000Z',
            periodEnd: '2026-10-01T00:00:00.000Z',
            quantityDelta: '-2.000000',
            costDeltaEur: '0.015000',
            status: 'OPEN',
            reason: 'Invoice correction',
            decisionReason: null,
            createdAt: '2026-09-14T12:00:00.000Z',
            updatedAt: '2026-09-14T12:00:00.000Z',
          },
        ],
      };
    });

    render(<AdminMarginPage />);

    expect(await screen.findByText('Corrections de rapprochement')).toBeInTheDocument();
    expect(screen.getByText('restaurant:rest-1')).toBeInTheDocument();
    expect(screen.getByText('À valider')).toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith('admin/usage/reconciliation-adjustments?limit=100');
  });
});
