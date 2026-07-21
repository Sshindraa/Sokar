import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FloorPlanPage from './page';

const mocks = vi.hoisted(() => {
  let searchParamsString = '';

  return {
    replace: vi.fn(),
    getSearchParams: () => new URLSearchParams(searchParamsString),
    setSearchParams: (query: string) => {
      searchParamsString = query;
    },
  };
});

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const canvasMock = vi.hoisted(() =>
  vi.fn(({ mode, floorPlanId }: { mode: string; floorPlanId?: string }) => (
    <div data-mode={mode} data-floor-plan-id={floorPlanId}>
      {mode}
    </div>
  )),
);

const crudMock = vi.hoisted(() =>
  vi.fn(({ floorPlanId }: { floorPlanId?: string }) => (
    <div data-testid="floor-plan-crud" data-floor-plan-id={floorPlanId}>
      crud
    </div>
  )),
);

const selectorMock = vi.hoisted(() =>
  vi.fn(
    ({
      floorPlans,
      selectedId,
      onSelect,
      onCreate,
    }: {
      floorPlans: { id: string; name: string }[];
      selectedId?: string;
      onSelect: (id: string) => void;
      onCreate: () => void;
    }) => (
      <div data-testid="floor-plan-selector">
        <select
          data-testid="floor-plan-select"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
        >
          {floorPlans.map((fp) => (
            <option key={fp.id} value={fp.id}>
              {fp.name}
            </option>
          ))}
        </select>
        <button data-testid="create-floor-plan" onClick={onCreate}>
          Créer un plan
        </button>
      </div>
    ),
  ),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => '/dashboard/floor-plan',
  useSearchParams: mocks.getSearchParams,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ orgId: 'org_test', get: apiMocks.get, post: apiMocks.post }),
}));

vi.mock('./_components/FloorPlanCanvas', () => ({
  FloorPlanCanvas: canvasMock,
}));

vi.mock('./_components/FloorPlanCrud', () => ({
  FloorPlanCrud: crudMock,
}));

vi.mock('./_components/FloorPlanSelector', () => ({
  FloorPlanSelector: selectorMock,
}));

const floorPlansFixture = [
  { id: 'fp-1', name: 'Salle principale', isDefault: true, isActive: true, tableCount: 3 },
  { id: 'fp-2', name: 'Terrasse', isDefault: false, isActive: true, tableCount: 1 },
];

describe('FloorPlanPage — switch desktop', () => {
  beforeEach(() => {
    mocks.replace.mockClear();
    mocks.setSearchParams('');
    canvasMock.mockClear();
    crudMock.mockClear();
    selectorMock.mockClear();
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    apiMocks.get.mockResolvedValue(floorPlansFixture);
    apiMocks.post.mockResolvedValue({ id: 'fp-3', name: 'Nouveau plan' });
  });

  it('charge la liste des plans et sélectionne le plan par défaut actif', async () => {
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(apiMocks.get).toHaveBeenCalledWith('restaurants/org_test/floor-plans');
    });

    expect(screen.getByTestId('floor-plan-selector')).toBeInTheDocument();
    expect(canvasMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ mode: 'service', floorPlanId: 'fp-1' }),
    );
  });

  it('transmet le signalement vocal puis nettoie son URL après application', async () => {
    mocks.setSearchParams(
      'reservationId=res-1&delayMinutes=25&delayReportId=report-1&serviceDate=2026-07-21&foo=bar',
    );
    render(<FloorPlanPage />);

    await waitFor(() => expect(canvasMock).toHaveBeenCalled());
    const props = canvasMock.mock.calls.at(-1)?.[0] as unknown as {
      initialDelayImpact: {
        reservationId: string;
        delayMinutes: number;
        delayReportId: string;
        serviceDate: string;
      };
      onInitialDelayApplied: () => void;
    };
    expect(props.initialDelayImpact).toEqual({
      reservationId: 'res-1',
      delayMinutes: 25,
      delayReportId: 'report-1',
      serviceDate: '2026-07-21',
    });

    props.onInitialDelayApplied();
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard/floor-plan?foo=bar', {
      scroll: false,
    });
  });

  it('passe au plan sélectionné et affiche le bon floorPlanId', async () => {
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('floor-plan-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('floor-plan-select'), { target: { value: 'fp-2' } });

    await waitFor(() => {
      expect(canvasMock.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ mode: 'service', floorPlanId: 'fp-2' }),
      );
    });
  });

  it('affiche le titre Live service par défaut', async () => {
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Live service' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Live service' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Salle édition' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('service')).toBeInTheDocument();
  });

  it('affiche le titre Salle édition quand view=edit-plan', async () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Salle édition' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Salle édition' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Live service' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('design')).toBeInTheDocument();
  });

  it('met à jour l’URL vers service-live en conservant les autres paramètres', async () => {
    mocks.setSearchParams('view=edit-plan&date=2025-09-15');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live service' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Live service' }));

    expect(mocks.replace).toHaveBeenCalledWith('/dashboard/floor-plan?date=2025-09-15', {
      scroll: false,
    });
  });

  it('supprime proprement le paramètre view quand il n’y a pas d’autres params', async () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Live service' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Live service' }));

    expect(mocks.replace).toHaveBeenCalledWith('/dashboard/floor-plan', { scroll: false });
  });

  it('met à jour l’URL vers edit-plan en conservant les autres paramètres', async () => {
    mocks.setSearchParams('date=2025-09-15');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Salle édition' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Salle édition' }));

    expect(mocks.replace).toHaveBeenCalledWith(
      '/dashboard/floor-plan?date=2025-09-15&view=edit-plan',
      { scroll: false },
    );
  });

  it('affiche les onglets design en mode edit-plan avec Plan visuel actif', async () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Plan visuel' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(screen.getByRole('button', { name: 'Sections & tables' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('design')).toBeInTheDocument();
  });

  it('affiche FloorPlanCrud en cliquant sur Sections & tables', async () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sections & tables' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sections & tables' }));

    expect(screen.getByTestId('floor-plan-crud')).toBeInTheDocument();
    expect(screen.queryByText('design')).not.toBeInTheDocument();
  });

  it('ré-affiche le canvas design en cliquant sur Plan visuel', async () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sections & tables' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sections & tables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan visuel' }));

    expect(screen.getByText('design')).toBeInTheDocument();
    expect(screen.queryByTestId('floor-plan-crud')).not.toBeInTheDocument();
  });

  it('n’affiche pas les onglets design en mode service-live', async () => {
    mocks.setSearchParams('');
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByText('service')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Plan visuel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sections & tables' })).not.toBeInTheDocument();
  });

  it('ouvre la boîte de dialogue de création et crée un plan', async () => {
    render(<FloorPlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-floor-plan')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-floor-plan'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Créer un plan de salle' })).toBeInTheDocument();
  });
});
