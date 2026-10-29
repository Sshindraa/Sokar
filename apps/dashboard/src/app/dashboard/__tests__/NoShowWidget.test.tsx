import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NoShowWidget from '../NoShowWidget';

const mockGet = vi.fn();
const mockUseApi = vi.fn(() => ({
  orgId: 'org_test_123' as string | undefined,
  isSignedIn: true,
  get: mockGet,
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mockUseApi(),
}));

type SmsGroup = {
  total: number;
  noShows: number;
  rate: number;
};

type NoShowStats = {
  total: number;
  noShows: number;
  noShowRate: number;
  revenueLost: number;
  withSms: SmsGroup;
  withoutSms: SmsGroup;
  impact: number | null;
};

function makeSmsGroup(overrides: Partial<SmsGroup> = {}): SmsGroup {
  return {
    total: 50,
    noShows: 2,
    rate: 4.0,
    ...overrides,
  };
}

function makeStats(overrides: Partial<NoShowStats> = {}): NoShowStats {
  return {
    total: 120,
    noShows: 8,
    noShowRate: 6.7,
    revenueLost: 1234,
    withSms: makeSmsGroup(),
    withoutSms: makeSmsGroup({ total: 40, noShows: 5, rate: 12.5 }),
    impact: 8.5,
    ...overrides,
  };
}

describe('NoShowWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApi.mockReturnValue({
      orgId: 'org_test_123',
      isSignedIn: true,
      get: mockGet,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    });
  });

  it('état loading : affiche une section avec des skeletons', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<NoShowWidget />);
    expect(document.querySelector('section')).toBeInTheDocument();
  });

  it("retourne null si pas d'orgId", () => {
    mockUseApi.mockReturnValue({
      orgId: undefined,
      isSignedIn: false,
      get: mockGet,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    });
    const { container } = render(<NoShowWidget />);
    expect(container.firstChild).toBeNull();
  });

  it('retourne null si total === 0', async () => {
    mockGet.mockResolvedValue(makeStats({ total: 0, noShows: 0, noShowRate: 0, revenueLost: 0 }));
    const { container } = render(<NoShowWidget />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('affiche les KPIs avec un impact positif du rappel SMS', async () => {
    mockGet.mockResolvedValue(makeStats());
    render(<NoShowWidget />);

    await waitFor(() => {
      expect(screen.getByText('Absences')).toBeInTheDocument();
    });

    expect(screen.getByText(/120 réservations/)).toBeInTheDocument();
    expect(screen.getByText('Taux')).toBeInTheDocument();
    expect(screen.getByText('6,7 %')).toBeInTheDocument();
    expect(screen.getByText(/8 absences sur 120/)).toBeInTheDocument();

    expect(screen.getByText('Montant associé aux absences')).toBeInTheDocument();
    expect(screen.getByText(/1\s234\s€/)).toBeInTheDocument();

    expect(screen.getByText('Écart observé avec / sans SMS')).toBeInTheDocument();
    fireEvent.focus(
      screen.getByRole('button', { name: 'Comprendre la comparaison avec et sans SMS' }),
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'ne prouve pas un effet du rappel',
    );
    expect(screen.getByText('8,5 pts')).toBeInTheDocument();
    expect(screen.getByText('d’absences en moins dans le groupe avec SMS')).toBeInTheDocument();
    expect(screen.getByText('4,0 % avec SMS · 12,5 % sans')).toBeInTheDocument();
  });

  it('affiche "Données insuffisantes" quand le calcul impact est impossible', async () => {
    mockGet.mockResolvedValue(
      makeStats({
        impact: null,
        withSms: makeSmsGroup({ total: 2, noShows: 0, rate: 0 }),
      }),
    );
    render(<NoShowWidget />);

    await waitFor(() => {
      expect(screen.getByText('Données insuffisantes')).toBeInTheDocument();
    });

    expect(screen.getByText(/2\/5 réservations avec SMS/)).toBeInTheDocument();
  });

  it('affiche les KPIs quand il y a des réservations mais aucun no-show', async () => {
    mockGet.mockResolvedValue(
      makeStats({
        noShows: 0,
        noShowRate: 0,
        revenueLost: 0,
        impact: null,
      }),
    );
    render(<NoShowWidget />);

    await waitFor(() => {
      expect(screen.getByText('Absences')).toBeInTheDocument();
    });

    // Taux global à 0,0 % et CA perdu à 0 €
    expect(screen.getByText('0,0 %')).toBeInTheDocument();
    expect(screen.getByText(/0\s€/)).toBeInTheDocument();
    // Impact SMS non calculable → "Données insuffisantes"
    expect(screen.getByText('Données insuffisantes')).toBeInTheDocument();
  });

  it('dit « aucun gain mesuré » quand les no-shows sont plus nombreux avec le SMS', async () => {
    mockGet.mockResolvedValue(
      makeStats({
        impact: -2,
        withSms: makeSmsGroup({ total: 50, noShows: 6, rate: 12 }),
        withoutSms: makeSmsGroup({ total: 40, noShows: 4, rate: 10 }),
      }),
    );
    render(<NoShowWidget />);

    await waitFor(() => {
      expect(screen.getByText('2,0 pts')).toBeInTheDocument();
    });
    expect(
      screen.getByText('2,0 pts d’absences en plus dans le groupe avec SMS'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/d’absences en moins/)).not.toBeInTheDocument();
  });

  it('signale une panne au lieu de disparaître, avec un bouton pour réessayer', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    mockGet.mockResolvedValueOnce(makeStats());
    render(<NoShowWidget />);

    await waitFor(() => {
      expect(
        screen.getByText('Les statistiques d’absence sont momentanément indisponibles.'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('Absences')).toBeInTheDocument();
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('appelle le endpoint dashboard/no-show-stats', async () => {
    mockGet.mockResolvedValue(makeStats());
    render(<NoShowWidget />);

    await waitFor(() => {
      expect(screen.getByText('Absences')).toBeInTheDocument();
    });

    expect(mockGet).toHaveBeenCalledWith('dashboard/no-show-stats');
  });
});
