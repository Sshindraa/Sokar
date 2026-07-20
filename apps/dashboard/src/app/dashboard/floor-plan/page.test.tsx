import { render, screen, fireEvent } from '@testing-library/react';
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => '/dashboard/floor-plan',
  useSearchParams: mocks.getSearchParams,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ orgId: 'org_test' }),
}));

vi.mock('./_components/FloorPlanCanvas', () => ({
  FloorPlanCanvas: ({ mode }: { mode: string }) => <div data-mode={mode}>{mode}</div>,
}));

vi.mock('./_components/FloorPlanCrud', () => ({
  FloorPlanCrud: () => <div data-testid="floor-plan-crud">crud</div>,
}));

describe('FloorPlanPage — switch desktop', () => {
  beforeEach(() => {
    mocks.replace.mockClear();
    mocks.setSearchParams('');
  });

  it('affiche le titre Live service par défaut', () => {
    render(<FloorPlanPage />);

    expect(screen.getByRole('heading', { name: 'Live service' })).toBeInTheDocument();
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

  it('affiche le titre Salle édition quand view=edit-plan', () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    expect(screen.getByRole('heading', { name: 'Salle édition' })).toBeInTheDocument();
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

  it('met à jour l’URL vers service-live en conservant les autres paramètres', () => {
    mocks.setSearchParams('view=edit-plan&date=2025-09-15');
    render(<FloorPlanPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Live service' }));

    expect(mocks.replace).toHaveBeenCalledWith('/dashboard/floor-plan?date=2025-09-15', {
      scroll: false,
    });
  });

  it('supprime proprement le paramètre view quand il n’y a pas d’autres params', () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Live service' }));

    expect(mocks.replace).toHaveBeenCalledWith('/dashboard/floor-plan', { scroll: false });
  });

  it('met à jour l’URL vers edit-plan en conservant les autres paramètres', () => {
    mocks.setSearchParams('date=2025-09-15');
    render(<FloorPlanPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Salle édition' }));

    expect(mocks.replace).toHaveBeenCalledWith(
      '/dashboard/floor-plan?date=2025-09-15&view=edit-plan',
      { scroll: false },
    );
  });

  it('affiche les onglets design en mode edit-plan avec Plan visuel actif', () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    expect(screen.getByRole('button', { name: 'Plan visuel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sections & tables' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('design')).toBeInTheDocument();
  });

  it('affiche FloorPlanCrud en cliquant sur Sections & tables', () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Sections & tables' }));

    expect(screen.getByTestId('floor-plan-crud')).toBeInTheDocument();
    expect(screen.queryByText('design')).not.toBeInTheDocument();
  });

  it('ré-affiche le canvas design en cliquant sur Plan visuel', () => {
    mocks.setSearchParams('view=edit-plan');
    render(<FloorPlanPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Sections & tables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan visuel' }));

    expect(screen.getByText('design')).toBeInTheDocument();
    expect(screen.queryByTestId('floor-plan-crud')).not.toBeInTheDocument();
  });

  it('n’affiche pas les onglets design en mode service-live', () => {
    mocks.setSearchParams('');
    render(<FloorPlanPage />);

    expect(screen.queryByRole('button', { name: 'Plan visuel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sections & tables' })).not.toBeInTheDocument();
  });
});
