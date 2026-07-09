import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import EmptySlotsWidget from '../EmptySlotsWidget';

// Mock contrôlable du hook useApi — on délègue à un objet mutable
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

function makeDay(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-07-01',
    dayName: 'mar',
    isOpen: true,
    openTime: '12:00',
    closeTime: '22:00',
    reservationCount: 5,
    covers: 12,
    isUnderbooked: false,
    revenueAtRisk: 0,
    ...overrides,
  };
}

function makeResponse(
  days: ReturnType<typeof makeDay>[],
  summaryOverrides: Record<string, unknown> = {},
) {
  return {
    days,
    summary: {
      underbookedDays: 0,
      totalOpenDays: days.length,
      revenueAtRisk: 0,
      avgRevenuePerReservation: 35,
      threshold: 5,
      ...summaryOverrides,
    },
  };
}

describe('EmptySlotsWidget', () => {
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

  it('état loading : affiche un skeleton', () => {
    // get ne résout jamais → loading reste true
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<EmptySlotsWidget />);
    // Le skeleton est rendu dans une section
    expect(document.querySelector('section')).toBeInTheDocument();
  });

  it("état error : ne crash pas et n'affiche pas la grille", async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    render(<EmptySlotsWidget />);
    // En cas d'erreur, le composant retourne null
    await waitFor(() => {
      expect(document.querySelector('section')).not.toBeInTheDocument();
    });
  });

  it('état data : affiche la grille 7 jours', async () => {
    const days = [
      makeDay({ date: '2026-07-01', dayName: 'mar', reservationCount: 8 }),
      makeDay({
        date: '2026-07-02',
        dayName: 'mer',
        reservationCount: 3,
        isUnderbooked: true,
        revenueAtRisk: 120,
      }),
      makeDay({ date: '2026-07-03', dayName: 'jeu', reservationCount: 6 }),
      makeDay({ date: '2026-07-04', dayName: 'ven', reservationCount: 10 }),
      makeDay({ date: '2026-07-05', dayName: 'sam', reservationCount: 12 }),
      makeDay({ date: '2026-07-06', dayName: 'dim', isOpen: false }),
      makeDay({ date: '2026-07-07', dayName: 'lun', reservationCount: 7 }),
    ];
    mockGet.mockResolvedValue(makeResponse(days, { underbookedDays: 1, revenueAtRisk: 120 }));

    render(<EmptySlotsWidget />);

    // Attend que le titre apparaisse (indique que les données sont chargées)
    await waitFor(() => {
      expect(screen.getByText(/sous-réservé/i)).toBeInTheDocument();
    });

    // Vérifie que les libellés de jours sont rendus (grille 7 jours)
    expect(screen.getByText('Mardi')).toBeInTheDocument();
    expect(screen.getByText('Mercredi')).toBeInTheDocument();
    expect(screen.getByText('Dimanche')).toBeInTheDocument();

    // Vérifie qu'un jour fermé affiche "Fermé"
    expect(screen.getByText('Fermé')).toBeInTheDocument();
  });

  it("état data : semaine bien remplie (pas d'alerte)", async () => {
    const days = [
      makeDay({ date: '2026-07-10', dayName: 'mar' }),
      makeDay({ date: '2026-07-11', dayName: 'mer' }),
    ];
    mockGet.mockResolvedValue(makeResponse(days, { underbookedDays: 0 }));

    render(<EmptySlotsWidget />);

    await waitFor(() => {
      expect(screen.getByText('Semaine bien remplie')).toBeInTheDocument();
    });
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
    const { container } = render(<EmptySlotsWidget />);
    expect(container.firstChild).toBeNull();
  });
});
