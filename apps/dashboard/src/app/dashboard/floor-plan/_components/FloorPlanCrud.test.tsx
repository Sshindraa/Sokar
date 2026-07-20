import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloorPlanCrud } from './FloorPlanCrud';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  orgId: 'org_test',
}));

vi.mock('@/lib/api', () => ({
  useApi: () => apiMocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, onCancel, title, description }: any) =>
    open ? (
      <div data-testid="confirm-dialog" data-title={title}>
        <span data-testid="confirm-description">{description}</span>
        <button data-testid="confirm-yes" onClick={onConfirm}>
          Confirmer
        </button>
        <button data-testid="confirm-no" onClick={onCancel}>
          Annuler
        </button>
      </div>
    ) : null,
}));

const floorPlanFixture = {
  id: 'fp',
  name: 'Plan test',
  sections: [
    {
      id: 's1',
      name: 'Terrasse',
      position: 1,
      tables: [
        {
          id: 't1',
          name: 'T1',
          capacity: 4,
          minCapacity: 2,
          isActive: true,
          positionX: null,
          positionY: null,
          shape: null,
        },
        {
          id: 't2',
          name: 'T2',
          capacity: 2,
          minCapacity: 1,
          isActive: false,
          positionX: null,
          positionY: null,
          shape: null,
        },
      ],
    },
    {
      id: 's2',
      name: 'Salle principale',
      position: 2,
      tables: [
        {
          id: 't3',
          name: 'T3',
          capacity: 6,
          minCapacity: 4,
          isActive: true,
          positionX: null,
          positionY: null,
          shape: null,
        },
      ],
    },
  ],
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.get.mockResolvedValue(floorPlanFixture);
  apiMocks.post.mockResolvedValue({});
  apiMocks.put.mockResolvedValue({});
  apiMocks.patch.mockResolvedValue({});
  apiMocks.del.mockResolvedValue({});
});

describe('FloorPlanCrud', () => {
  it('affiche les skeletons pendant le chargement', () => {
    apiMocks.get.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<FloorPlanCrud />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Plan de salle' })).not.toBeInTheDocument();
  });

  it('affiche le message vide quand aucune section', async () => {
    apiMocks.get.mockResolvedValue({ id: 'fp', name: 'Plan', sections: [] });

    render(<FloorPlanCrud />);

    await waitFor(() => {
      expect(screen.getByText('Aucune section dans votre plan de salle')).toBeInTheDocument();
    });
  });

  it('affiche les sections et leurs tables', async () => {
    render(<FloorPlanCrud />);

    await screen.findByRole('heading', { name: 'Plan de salle' });

    expect(screen.getByText('Terrasse')).toBeInTheDocument();
    expect(screen.getByText('Salle principale')).toBeInTheDocument();
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('T3')).toBeInTheDocument();
    expect(screen.getByText('4 couverts (min. 2)')).toBeInTheDocument();
    expect(screen.getByText('6 couverts (min. 4)')).toBeInTheDocument();
  });

  it('crée une section', async () => {
    apiMocks.post.mockResolvedValue({
      id: 's3',
      name: 'Terrasse couverte',
      position: 3,
      tables: [],
    });

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const input = screen.getByLabelText('Nouvelle section');
    fireEvent.change(input, { target: { value: 'Terrasse couverte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith('restaurants/org_test/floor-plan/sections', {
        name: 'Terrasse couverte',
      });
    });

    expect(await screen.findByText('Terrasse couverte')).toBeInTheDocument();
  });

  it('renomme une section', async () => {
    apiMocks.put.mockResolvedValue({
      id: 's1',
      name: 'Terrasse extérieure',
      position: 1,
      tables: floorPlanFixture.sections[0].tables,
    });

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Renommer la section' })[0]);

    const input = screen.getByLabelText('Nom de la section');
    fireEvent.change(input, { target: { value: 'Terrasse extérieure' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(apiMocks.put).toHaveBeenCalledWith('restaurants/org_test/floor-plan/sections/s1', {
        name: 'Terrasse extérieure',
      });
    });

    expect(await screen.findByText('Terrasse extérieure')).toBeInTheDocument();
    expect(screen.queryByText('Terrasse')).not.toBeInTheDocument();
  });

  it('supprime une section avec confirmation', async () => {
    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer la section' })[0]);

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveAttribute('data-title', 'Supprimer la section');
    expect(screen.getByTestId('confirm-description')).toHaveTextContent(
      'Les tables associées ne seront pas supprimées, mais ne seront plus rattachées à une section.',
    );

    fireEvent.click(screen.getByTestId('confirm-yes'));

    await waitFor(() => {
      expect(apiMocks.del).toHaveBeenCalledWith('restaurants/org_test/floor-plan/sections/s1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Terrasse')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Salle principale')).toBeInTheDocument();
  });

  it('active et désactive une table', async () => {
    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const switches = screen.getAllByRole('switch');
    const tableSwitch = switches[0];

    expect(tableSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(tableSwitch);

    await waitFor(() => {
      expect(tableSwitch).toHaveAttribute('aria-checked', 'false');
    });

    expect(apiMocks.patch).toHaveBeenNthCalledWith(1, 'restaurants/org_test/floor-plan/tables/t1', {
      isActive: false,
    });

    fireEvent.click(tableSwitch);

    await waitFor(() => {
      expect(tableSwitch).toHaveAttribute('aria-checked', 'true');
    });

    expect(apiMocks.patch).toHaveBeenNthCalledWith(2, 'restaurants/org_test/floor-plan/tables/t1', {
      isActive: true,
    });
  });

  it('crée une table dans une section', async () => {
    apiMocks.post.mockResolvedValue({
      id: 't4',
      name: 'T4',
      capacity: 8,
      minCapacity: 1,
      isActive: true,
      positionX: null,
      positionY: null,
      shape: null,
    });

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const sectionCard = screen.getAllByTestId('section-card')[1];
    const tableInput = within(sectionCard).getByLabelText('Table');
    const capacityInput = within(sectionCard).getByLabelText('Couv.');

    fireEvent.change(tableInput, { target: { value: 'T4' } });
    fireEvent.change(capacityInput, { target: { value: '8' } });
    fireEvent.submit(tableInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith('restaurants/org_test/floor-plan/tables', {
        sectionId: 's2',
        name: 'T4',
        capacity: 8,
      });
    });

    expect(await screen.findByText('T4')).toBeInTheDocument();
    expect(screen.getByText('8 couverts')).toBeInTheDocument();
  });

  it('supprime une table avec confirmation', async () => {
    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const sectionCard = screen.getAllByTestId('section-card')[1];
    fireEvent.click(within(sectionCard).getByRole('button', { name: 'Supprimer la table' }));

    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-yes'));

    await waitFor(() => {
      expect(apiMocks.del).toHaveBeenCalledWith('restaurants/org_test/floor-plan/tables/t3');
    });

    await waitFor(() => {
      expect(screen.queryByText('T3')).not.toBeInTheDocument();
    });
  });

  it('affiche une erreur si le chargement échoue', async () => {
    apiMocks.get.mockRejectedValue(new Error('network error'));

    render(<FloorPlanCrud />);

    expect(await screen.findByText('network error')).toBeInTheDocument();
  });

  it('affiche une erreur si la création de section échoue', async () => {
    apiMocks.post.mockRejectedValue(new Error('create failed'));

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    fireEvent.change(screen.getByLabelText('Nouvelle section'), {
      target: { value: 'Nouveau' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('create failed')).toBeInTheDocument();
  });

  it('affiche une erreur si la suppression de section échoue', async () => {
    apiMocks.del.mockRejectedValue(new Error('delete section failed'));

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer la section' })[0]);

    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-yes'));

    expect(await screen.findByText('delete section failed')).toBeInTheDocument();
    expect(screen.getByText('Terrasse')).toBeInTheDocument();
    expect(apiMocks.del).toHaveBeenCalledWith('restaurants/org_test/floor-plan/sections/s1');
  });

  it('affiche une erreur si le renommage de section échoue', async () => {
    apiMocks.put.mockRejectedValue(new Error('rename section failed'));

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Renommer la section' })[0]);

    const sectionCard = screen.getAllByTestId('section-card')[0];
    const input = within(sectionCard).getByLabelText('Nom de la section');
    fireEvent.change(input, { target: { value: 'Terrasse extérieure' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(await screen.findByText('rename section failed')).toBeInTheDocument();
    expect(within(sectionCard).getByDisplayValue('Terrasse')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Terrasse extérieure')).not.toBeInTheDocument();
    expect(apiMocks.put).toHaveBeenCalledWith('restaurants/org_test/floor-plan/sections/s1', {
      name: 'Terrasse extérieure',
    });
  });

  it('affiche une erreur si la création de table échoue', async () => {
    apiMocks.post.mockRejectedValue(new Error('create table failed'));

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const sectionCard = screen.getAllByTestId('section-card')[1];
    const tableInput = within(sectionCard).getByLabelText('Table');
    const capacityInput = within(sectionCard).getByLabelText('Couv.');

    fireEvent.change(tableInput, { target: { value: 'T4' } });
    fireEvent.change(capacityInput, { target: { value: '8' } });
    fireEvent.submit(tableInput.closest('form') as HTMLFormElement);

    expect(await screen.findByText('create table failed')).toBeInTheDocument();
    expect(screen.queryByText('T4')).not.toBeInTheDocument();
    expect(apiMocks.post).toHaveBeenCalledWith('restaurants/org_test/floor-plan/tables', {
      sectionId: 's2',
      name: 'T4',
      capacity: 8,
    });
  });

  it('affiche une erreur si la suppression de table échoue', async () => {
    apiMocks.del.mockRejectedValue(new Error('delete table failed'));

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const sectionCard = screen.getAllByTestId('section-card')[1];
    fireEvent.click(within(sectionCard).getByRole('button', { name: 'Supprimer la table' }));

    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-yes'));

    expect(await screen.findByText('delete table failed')).toBeInTheDocument();
    expect(screen.getByText('T3')).toBeInTheDocument();
    expect(apiMocks.del).toHaveBeenCalledWith('restaurants/org_test/floor-plan/tables/t3');
  });

  it('affiche une erreur si le changement d’état d’une table échoue', async () => {
    apiMocks.patch.mockRejectedValue(new Error('toggle table failed'));

    render(<FloorPlanCrud />);
    await screen.findByRole('heading', { name: 'Plan de salle' });

    const tableSwitch = screen.getAllByRole('switch')[0];
    expect(tableSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(tableSwitch);

    expect(await screen.findByText('toggle table failed')).toBeInTheDocument();
    await waitFor(() => {
      expect(tableSwitch).toHaveAttribute('aria-checked', 'true');
    });
    expect(apiMocks.patch).toHaveBeenCalledWith('restaurants/org_test/floor-plan/tables/t1', {
      isActive: false,
    });
  });
});
