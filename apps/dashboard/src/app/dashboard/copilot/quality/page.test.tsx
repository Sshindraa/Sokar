import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CopilotQualityPage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ orgId: 'org_test', get: apiMocks.get }),
}));

const summary = {
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-07-31T00:00:00.000Z',
  totals: {
    observed: 0,
    opened: 1,
    applied: 4,
    reverted: 1,
    conflicted: 2,
    expired: 0,
    ignored: 3,
  },
  byKind: [
    {
      kind: 'reported-delay',
      totals: {
        observed: 0,
        opened: 0,
        applied: 4,
        reverted: 1,
        conflicted: 2,
        expired: 0,
        ignored: 0,
      },
    },
  ],
};

describe('CopilotQualityPage', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.get.mockResolvedValue(summary);
  });

  it('affiche les résultats dans Copilot et non dans la Salle', async () => {
    render(<CopilotQualityPage />);

    await waitFor(() => {
      expect(apiMocks.get).toHaveBeenCalledWith(
        'restaurants/org_test/service-copilot/telemetry-summary?days=30',
        expect.anything(),
      );
    });

    expect(
      screen.getByRole('heading', { name: 'Qualité des recommandations' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Retard signalé')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /retour au copilot/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('recharge les données avec la période choisie', async () => {
    render(<CopilotQualityPage />);
    await screen.findByText('Retard signalé');

    fireEvent.click(screen.getByRole('button', { name: '7 jours' }));

    await waitFor(() => {
      expect(apiMocks.get).toHaveBeenLastCalledWith(
        'restaurants/org_test/service-copilot/telemetry-summary?days=7',
        expect.anything(),
      );
    });
  });
});
