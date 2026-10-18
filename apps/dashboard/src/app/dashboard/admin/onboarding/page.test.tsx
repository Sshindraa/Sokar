import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { toApiError } from '@/lib/api-error';
import AdminOnboardingPage from './page';
import { sortForFollowUp, stepLabel, type RestaurantProgress } from './cohort';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));

function row(overrides: Partial<RestaurantProgress>): RestaurantProgress {
  return {
    restaurantId: 'r',
    restaurantName: 'Resto',
    startedAt: '2026-10-01T10:00:00.000Z',
    lastEventAt: '2026-10-02T10:00:00.000Z',
    completedSteps: 3,
    blockedSteps: 0,
    firstReservationAt: null,
    hoursToFirstReservation: null,
    ...overrides,
  };
}

const FUNNEL = {
  restaurants: 2,
  totalEvents: 10,
  steps: [
    {
      step: 'connect-identity',
      started: 2,
      completed: 1,
      skipped: 0,
      blocked: 0,
      abandoned: 1,
      completionRate: 50,
    },
  ],
  milestones: { activated: 1, firstCall: 1, demoCallPlayed: 0 },
  timeToFirstReservation: { measured: 1, pending: 1, medianHours: 5, p90Hours: 5 },
  overallCompletionRate: 50,
};

describe('cohorte d’onboarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('met en tête les établissements à relancer, comme la page l’annonce', () => {
    const sorted = sortForFollowUp([
      row({ restaurantId: 'ok', firstReservationAt: '2026-10-03T10:00:00.000Z' }),
      row({ restaurantId: 'bloque', blockedSteps: 2 }),
      row({ restaurantId: 'attend', blockedSteps: 0 }),
    ]);
    expect(sorted.map((item) => item.restaurantId)).toEqual(['bloque', 'attend', 'ok']);
  });

  it('nomme les étapes en français', () => {
    expect(stepLabel('connect-identity')).toBe('Page en ligne : identité');
    expect(stepLabel('etape-inconnue')).toBe('Autre étape');
  });

  it('affiche le nom des établissements, les étapes en clair et le vrai dernier signal', async () => {
    mocks.get.mockResolvedValue({
      funnel: FUNNEL,
      restaurants: [
        row({
          restaurantId: 'abcdef123456',
          restaurantName: 'Chez Émile',
          lastEventAt: '2026-10-05T10:00:00.000Z',
        }),
        row({
          restaurantId: 'zzzzzz999999',
          restaurantName: 'Le Bistrot',
          lastEventAt: '2026-10-09T10:00:00.000Z',
        }),
      ],
    });
    render(<AdminOnboardingPage />);

    expect(await screen.findByText('Chez Émile')).toBeInTheDocument();
    expect(screen.queryByText('abcdef12')).toBeNull();
    expect(screen.getByText('Page en ligne : identité')).toBeInTheDocument();
    expect(screen.queryByText('connect-identity')).toBeNull();
    expect(screen.getByText(/Dernier signal : 09\/10\/26/)).toBeInTheDocument();
  });

  it('traduit l’échec de chargement et propose de réessayer', async () => {
    mocks.get.mockRejectedValueOnce(
      toApiError(500, { error: 'Failed to read onboarding cohort funnel' }),
    );
    render(<AdminOnboardingPage />);

    const card = (await screen.findByText('Funnel indisponible')).closest('div') as HTMLElement;
    expect(within(card).queryByText(/Failed to read/)).toBeNull();
    mocks.get.mockResolvedValue({ funnel: FUNNEL, restaurants: [row({})] });
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Resto')).toBeInTheDocument();
  });
});
