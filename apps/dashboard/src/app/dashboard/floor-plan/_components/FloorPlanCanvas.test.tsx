import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampZoom,
  computeCenterScroll,
  computeContentBounds,
  computeFitZoom,
  computeFocusScroll,
  computeLiveContentBounds,
  computeZoomAnchorScroll,
  findDuplicatePosition,
  FloorPlanCanvas,
  getTableAlignmentGuides,
  getChairPositions,
  getSafeTableDimensions,
  isDoubleTap,
  StatsPanel,
  TABLE_LAYOUT,
  WaitingListPanel,
} from './FloorPlanCanvas';
import type { FloorPlan, FloorPlanWall, PlanningReservation, WaitingListEntry } from '@/types/api';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

const activeWall: FloorPlanWall = {
  id: 'wall-active',
  x1: 300,
  y1: 280,
  x2: 456,
  y2: 280,
  type: 'wall',
  name: null,
};

const referenceWall: FloorPlanWall = {
  id: 'wall-reference',
  x1: 480,
  y1: 100,
  x2: 480,
  y2: 280,
  type: 'wall',
  name: null,
};

const floorPlan: FloorPlan = {
  id: 'floor-plan-test',
  name: 'Plan test',
  isDefault: true,
  isActive: true,
  width: 700,
  height: 420,
  sections: [],
  tables: [
    {
      id: 'table-t4-minimum-round',
      name: 'T4',
      capacity: 4,
      minCapacity: 1,
      isActive: true,
      positionX: 64,
      positionY: 64,
      width: TABLE_LAYOUT.minimumDimension,
      height: TABLE_LAYOUT.minimumDimension,
      rotation: 0,
      shape: 'round',
    },
  ],
  walls: [activeWall, referenceWall],
};

const waitingListEntry: WaitingListEntry = {
  id: 'waiting-list-1',
  partySize: 4,
  customerFirstName: 'Alice',
  customerLastName: 'Martin',
  customerPhone: '+33612345678',
  slotStart: '2025-06-10T19:30:00.000Z',
  slotEnd: '2025-06-10T21:00:00.000Z',
  preferredSectionName: 'Terrasse',
  status: 'PENDING',
  position: 1,
  createdAt: '2025-06-10T18:00:00.000Z',
};

vi.mock('@/lib/api', () => ({
  useApi: () => apiMocks,
}));

// jsdom n'implémente pas `matchMedia` : le mock rend le chemin tactile
// pilotable par test, tout en gardant le rendu desktop par défaut.
const mediaMocks = vi.hoisted(() => ({ mobile: false, touch: false, coarse: false }));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => mediaMocks.mobile,
  useMediaQuery: (query: string) =>
    query === '(pointer: coarse)' ? mediaMocks.coarse : mediaMocks.touch,
}));

beforeEach(() => {
  mediaMocks.mobile = false;
  mediaMocks.touch = false;
  mediaMocks.coarse = false;
  apiMocks.get.mockReset();
  apiMocks.post.mockReset();
  apiMocks.patch.mockReset();
  apiMocks.del.mockReset();
  apiMocks.get.mockImplementation(async (path: string) => {
    if (path.includes('/reservations')) return [];
    return floorPlan;
  });
  apiMocks.post.mockResolvedValue({});
  apiMocks.patch.mockResolvedValue({});
  apiMocks.del.mockResolvedValue({});
});

function getRectangleChairGap(left: number, top: number, width: number, height: number): number {
  const chairRight = left + TABLE_LAYOUT.chairSize;
  const chairBottom = top + TABLE_LAYOUT.chairSize;
  const tableLeft = -TABLE_LAYOUT.borderWidth;
  const tableTop = -TABLE_LAYOUT.borderWidth;
  const tableRight = width - TABLE_LAYOUT.borderWidth;
  const tableBottom = height - TABLE_LAYOUT.borderWidth;

  return Math.max(
    tableLeft - chairRight,
    left - tableRight,
    tableTop - chairBottom,
    top - tableBottom,
  );
}

function getMinimumEllipseValue(left: number, top: number, width: number, height: number): number {
  const centerX = width / 2 - TABLE_LAYOUT.borderWidth;
  const centerY = height / 2 - TABLE_LAYOUT.borderWidth;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const closestX = Math.max(left, Math.min(centerX, left + TABLE_LAYOUT.chairSize));
  const closestY = Math.max(top, Math.min(centerY, top + TABLE_LAYOUT.chairSize));

  return ((closestX - centerX) / radiusX) ** 2 + ((closestY - centerY) / radiusY) ** 2;
}

describe('FloorPlanCanvas — disposition des chaises', () => {
  const smallestTable = {
    width: TABLE_LAYOUT.minimumDimension,
    height: TABLE_LAYOUT.minimumDimension,
  };

  it('keeps every rectangular chair outside the table with a gap at the minimum size', () => {
    for (let capacity = 1; capacity <= TABLE_LAYOUT.maximumChairCount; capacity++) {
      const chairs = getChairPositions({ ...smallestTable, capacity, shape: 'rect' });

      expect(chairs).toHaveLength(capacity);
      for (const chair of chairs) {
        expect(
          getRectangleChairGap(chair.left, chair.top, smallestTable.width, smallestTable.height),
        ).toBe(TABLE_LAYOUT.chairGap);
      }
    }
  });

  it('keeps every round-table chair fully outside the contour at safe sizes', () => {
    const roundTables = [
      smallestTable,
      {
        width: TABLE_LAYOUT.minimumDimension + 32,
        height: TABLE_LAYOUT.minimumDimension + 16,
      },
    ];

    for (const table of roundTables) {
      for (let capacity = 1; capacity <= TABLE_LAYOUT.maximumChairCount; capacity++) {
        const chairs = getChairPositions({ ...table, capacity, shape: 'round' });

        expect(chairs).toHaveLength(capacity);
        for (const chair of chairs) {
          expect(
            getMinimumEllipseValue(chair.left, chair.top, table.width, table.height),
          ).toBeGreaterThan(1);
        }
      }
    }
  });

  it('keeps cardinal chairs clear of a minimum-size round table', () => {
    const chairs = getChairPositions({ ...smallestTable, capacity: 4, shape: 'round' });
    const [topChair, rightChair, bottomChair, leftChair] = chairs;
    const tableTop = -TABLE_LAYOUT.borderWidth;
    const tableLeft = -TABLE_LAYOUT.borderWidth;
    const tableRight = smallestTable.width - TABLE_LAYOUT.borderWidth;
    const tableBottom = smallestTable.height - TABLE_LAYOUT.borderWidth;

    expect(chairs).toHaveLength(4);
    expect(tableTop - (topChair.top + TABLE_LAYOUT.chairSize)).toBeGreaterThanOrEqual(
      TABLE_LAYOUT.roundTableVisualGap,
    );
    expect(rightChair.left - tableRight).toBeGreaterThanOrEqual(TABLE_LAYOUT.roundTableVisualGap);
    expect(bottomChair.top - tableBottom).toBeGreaterThanOrEqual(TABLE_LAYOUT.roundTableVisualGap);
    expect(tableLeft - (leftChair.left + TABLE_LAYOUT.chairSize)).toBeGreaterThanOrEqual(
      TABLE_LAYOUT.roundTableVisualGap,
    );
  });

  it('clamps unsafe dimensions without changing safe ones', () => {
    const safeWidth = TABLE_LAYOUT.minimumDimension + 24;
    const safeHeight = TABLE_LAYOUT.minimumDimension + 40;

    expect(getSafeTableDimensions(1, safeHeight)).toEqual({
      width: TABLE_LAYOUT.minimumDimension,
      height: safeHeight,
    });
    expect(getSafeTableDimensions(safeWidth, 1)).toEqual({
      width: safeWidth,
      height: TABLE_LAYOUT.minimumDimension,
    });
    expect(getSafeTableDimensions(0, -1)).toEqual({
      width: TABLE_LAYOUT.minimumDimension,
      height: TABLE_LAYOUT.minimumDimension,
    });
    expect(getSafeTableDimensions(safeWidth, safeHeight)).toEqual({
      width: safeWidth,
      height: safeHeight,
    });
  });
});

describe('FloorPlanCanvas — guides et duplication de table', () => {
  const referenceTable = {
    id: 'reference',
    name: 'T1',
    capacity: 4,
    minCapacity: 1,
    isActive: true,
    positionX: 100,
    positionY: 100,
    width: 80,
    height: 80,
    rotation: 0,
    shape: 'rect' as const,
  };

  it('propose les guides de bord et de centre les plus proches pendant un drag', () => {
    const guides = getTableAlignmentGuides({
      x: 178,
      y: 100,
      width: 80,
      height: 80,
      tables: [referenceTable],
      excludedTableId: 'moving',
    });

    expect(guides.x).toMatchObject({ axis: 'x', value: 180, position: 180, distance: 2 });
    expect(guides.y).toMatchObject({ axis: 'y', value: 100, position: 100, distance: 0 });
  });

  it('duplique à proximité sans chevaucher la table voisine', () => {
    const source = { ...referenceTable, id: 'source', positionX: 96, positionY: 96 };
    const occupiedRight = {
      ...referenceTable,
      id: 'occupied-right',
      positionX: 192,
      positionY: 96,
    };

    expect(findDuplicatePosition(source, [source, occupiedRight], 800, 500)).toEqual({
      x: 96,
      y: 192,
    });
  });
});

describe('FloorPlanCanvas — taille des tables', () => {
  it('keeps a minimum-size round T4 card shrinkable to its explicit dimensions', async () => {
    render(<FloorPlanCanvas orgId="org_test" />);

    const table = await screen.findByRole('button', { name: 'T4 · 4 places' });

    expect(table).toHaveClass('min-w-0', 'min-h-0');
    expect(table).toHaveStyle({ width: '64px', height: '64px' });

    const tableName = within(table).getByText('T4');
    const capacity = within(table).getByText('4 places');

    expect(tableName).toHaveClass('max-w-full', 'truncate');
    expect(capacity).toHaveClass('truncate');
    expect(table.querySelectorAll('.bg-floor-table-chair')).toHaveLength(4);
    expect(table.querySelector('.rounded-full.bg-floor-table-surface')).toHaveStyle({
      width: '72px',
      height: '72px',
    });
    expect(table.querySelector('.bg-floor-table-accent')).not.toBeNull();
  });

  it('récupère le plan spécifique quand floorPlanId est fourni', async () => {
    render(<FloorPlanCanvas orgId="org_test" floorPlanId="fp-2" />);

    await waitFor(() => {
      expect(apiMocks.get).toHaveBeenCalledWith('restaurants/org_test/floor-plans/fp-2');
    });

    const table = await screen.findByRole('button', { name: 'T4 · 4 places' });
    expect(table).toBeInTheDocument();
  });
});

describe('FloorPlanCanvas — guides des murs', () => {
  beforeEach(() => {
    apiMocks.patch.mockReset();
    apiMocks.patch.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path.includes('/tables/')) {
        const table = floorPlan.tables?.[0];
        if (!table) throw new Error('Fixture table missing');
        return { ...table, ...body };
      }
      return { ...activeWall, ...body };
    });
  });

  it('affiche et applique le guide de même longueur pendant le resize d’un mur', async () => {
    const { container } = render(<FloorPlanCanvas orgId="org_test" />);

    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('line[x1="300"][x2="456"]')!);

    const endHandle = await waitFor(() => {
      const handle = container.querySelector('circle[cx="456"][cy="280"]');
      expect(handle).toBeInTheDocument();
      return handle!;
    });

    fireEvent.pointerDown(endHandle, { clientX: 456, clientY: 280 });
    fireEvent.pointerMove(window, { clientX: 456, clientY: 280 });

    expect(await screen.findByText('Même longueur · 180 px')).toBeInTheDocument();
    expect(screen.queryByText('Aligné')).not.toBeInTheDocument();

    const snappedWall = container.querySelector('line[x1="300"][x2="480"]');
    expect(snappedWall).toBeInTheDocument();
  });

  it('annule et rétablit une mutation géométrique de mur', async () => {
    const { container } = render(<FloorPlanCanvas orgId="org_test" />);

    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    const undo = screen.getByRole('button', { name: 'Annuler' });
    const redo = screen.getByRole('button', { name: 'Rétablir' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    fireEvent.click(container.querySelector('line[x1="300"][x2="456"]')!);
    const endHandle = await waitFor(() => {
      const handle = container.querySelector('circle[cx="456"][cy="280"]');
      expect(handle).toBeInTheDocument();
      return handle!;
    });

    fireEvent.pointerDown(endHandle, { clientX: 456, clientY: 280 });
    fireEvent.pointerMove(window, { clientX: 608, clientY: 280 });
    fireEvent.pointerUp(window);

    await waitFor(() => expect(undo).toBeEnabled());
    const movedWall = apiMocks.patch.mock.calls[
      apiMocks.patch.mock.calls.length - 1
    ][1] as FloorPlanWall;
    expect(movedWall.x2).not.toBe(456);

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await waitFor(() => {
      const revertedWall = apiMocks.patch.mock.calls[
        apiMocks.patch.mock.calls.length - 1
      ][1] as FloorPlanWall;
      expect(revertedWall).toMatchObject({ x1: 300, y1: 280, x2: 456, y2: 280 });
    });

    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    await waitFor(() => {
      const restoredWall = apiMocks.patch.mock.calls[
        apiMocks.patch.mock.calls.length - 1
      ][1] as FloorPlanWall;
      expect(restoredWall.x2).toBe(movedWall.x2);
    });
  });

  it('ignore une réponse de drag arrivée après undo', async () => {
    let resolveMove!: (wall: FloorPlanWall) => void;
    const delayedMove = new Promise<FloorPlanWall>((resolve) => {
      resolveMove = resolve;
    });
    apiMocks.patch
      .mockImplementationOnce(() => delayedMove)
      .mockImplementationOnce(async (_path: string, wall: Partial<FloorPlanWall>) => ({
        ...activeWall,
        ...wall,
      }));

    const { container } = render(<FloorPlanCanvas orgId="org_test" />);
    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('line[x1="300"][x2="456"]')!);
    const endHandle = await waitFor(() => {
      const handle = container.querySelector('circle[cx="456"][cy="280"]');
      expect(handle).toBeInTheDocument();
      return handle!;
    });
    fireEvent.pointerDown(endHandle, { clientX: 456, clientY: 280 });
    fireEvent.pointerMove(window, { clientX: 608, clientY: 280 });
    fireEvent.pointerUp(window);

    await waitFor(() => expect(apiMocks.patch).toHaveBeenCalledTimes(1));
    const movedWall = apiMocks.patch.mock.calls[0][1] as FloorPlanWall;

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(apiMocks.patch).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    await act(async () => {
      resolveMove(movedWall);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
      expect(container.querySelector(`line[x1="300"][x2="${movedWall.x2}"]`)).toBeNull();
    });
  });

  it('annule une position de mur modifiée depuis l’inspecteur', async () => {
    const { container } = render(<FloorPlanCanvas orgId="org_test" />);
    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('line[x1="300"][x2="456"]')!);
    const positionX = await screen.findByLabelText('Position X');
    fireEvent.change(positionX, { target: { value: '320' } });
    fireEvent.blur(positionX);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Annuler' })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    await waitFor(() => {
      const revertedWall = apiMocks.patch.mock.calls[
        apiMocks.patch.mock.calls.length - 1
      ][1] as FloorPlanWall;
      expect(revertedWall).toMatchObject({ x1: 300, x2: 456 });
    });
  });

  it('déplace une table sélectionnée avec les flèches et annule avec ⌘Z', async () => {
    const { container } = render(<FloorPlanCanvas orgId="org_test" />);
    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    const table = await screen.findByRole('button', { name: 'T4 · 4 places' });
    fireEvent.click(table);

    const undo = screen.getByRole('button', { name: 'Annuler' });
    expect(undo).toBeDisabled();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(undo).toBeEnabled());

    const movedTable = apiMocks.patch.mock.calls[apiMocks.patch.mock.calls.length - 1][1] as {
      positionX: number;
      positionY: number;
    };
    expect(movedTable.positionX).toBe(65);
    expect(movedTable.positionY).toBe(64);

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await waitFor(() => {
      const revertedTable = apiMocks.patch.mock.calls[apiMocks.patch.mock.calls.length - 1][1] as {
        positionX: number;
        positionY: number;
      };
      expect(revertedTable.positionX).toBe(64);
      expect(revertedTable.positionY).toBe(64);
    });

    fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => {
      const shiftedTable = apiMocks.patch.mock.calls[apiMocks.patch.mock.calls.length - 1][1] as {
        positionX: number;
        positionY: number;
      };
      expect(shiftedTable.positionX).toBe(64);
      expect(shiftedTable.positionY).toBe(74);
    });
  });

  it('ouvre la confirmation de suppression avec Delete sur une table sélectionnée', async () => {
    const { container } = render(<FloorPlanCanvas orgId="org_test" />);
    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole('button', { name: 'T4 · 4 places' }));
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(await screen.findByRole('heading', { name: 'Supprimer 1 tables' })).toBeInTheDocument();
  });

  it('supprime le mur sélectionné avec Backspace', async () => {
    const { container } = render(<FloorPlanCanvas orgId="org_test" />);
    await waitFor(() => {
      expect(container.querySelector('line[x1="300"][x2="456"]')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('line[x1="300"][x2="456"]')!);
    await screen.findByLabelText('Type');
    fireEvent.keyDown(window, { key: 'Backspace' });

    await waitFor(() => {
      expect(apiMocks.del).toHaveBeenCalledWith(
        expect.stringContaining('restaurants/org_test/floor-plan/walls/wall-active'),
      );
    });
  });
});

describe('FloorPlanCanvas — édition du plan', () => {
  it('affiche le libellé personnalisé d’une table sur le canvas', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/reservations')) return [];
      return {
        ...floorPlan,
        tables: [{ ...floorPlan.tables![0], name: 'Banquette 1' }],
      };
    });

    render(<FloorPlanCanvas orgId="org_test" mode="design" />);

    expect(
      await screen.findByRole('button', { name: 'Banquette 1 · 4 places' }),
    ).toBeInTheDocument();
  });

  it('dispose automatiquement les tables existantes au premier chargement', async () => {
    const unplacedTables = [
      {
        ...floorPlan.tables![0],
        id: 'table-unplaced-1',
        name: 'T1',
        positionX: null,
        positionY: null,
      },
      {
        ...floorPlan.tables![0],
        id: 'table-unplaced-2',
        name: 'T2',
        positionX: null,
        positionY: null,
      },
    ];
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/reservations')) return [];
      return { ...floorPlan, tables: unplacedTables, walls: [], sections: [] };
    });
    apiMocks.patch.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      const tableId = path.split('/').pop();
      const table = unplacedTables.find((item) => item.id === tableId);
      if (!table) throw new Error('Fixture table missing');
      return { ...table, ...body };
    });

    render(<FloorPlanCanvas orgId="org_test" mode="design" />);

    expect(
      await screen.findByText('Disposition initiale appliquée.', { exact: false }),
    ).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.patch).toHaveBeenCalledTimes(2));

    expect(screen.getByRole('button', { name: 'T1 · 4 places' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T2 · 4 places' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).not.toBeDisabled();
    expect(screen.queryByText('Construisez votre plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Tables à placer · 2')).not.toBeInTheDocument();
  });

  it('crée une table métier à placer depuis la palette', async () => {
    apiMocks.post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path.includes('/floor-plan/tables')) {
        return {
          id: 'table-created',
          name: 'T1',
          capacity: 4,
          minCapacity: 1,
          isActive: true,
          positionX: body.positionX,
          positionY: body.positionY,
          width: null,
          height: null,
          rotation: 0,
          shape: 'round',
        };
      }
      throw new Error(`Unexpected POST ${path}`);
    });
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/reservations')) return [];
      return { ...floorPlan, tables: [], walls: [], sections: [] };
    });

    render(<FloorPlanCanvas orgId="org_test" mode="design" />);

    expect(await screen.findByText('Aucune table configurée')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une table' }));

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith(
        'restaurants/org_test/floor-plan/tables',
        expect.objectContaining({
          shape: 'rect',
          capacity: 4,
          name: 'T1',
          positionX: null,
          positionY: null,
        }),
      );
    });

    expect(await screen.findByText('Table T1', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Tables à placer · 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Table ronde/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nouvelle table' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('garde un inspecteur discret quand rien n’est sélectionné', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/reservations')) return [];
      return { ...floorPlan, tables: [], walls: [], sections: [] };
    });

    render(<FloorPlanCanvas orgId="org_test" mode="design" />);

    expect(await screen.findByText('Aucune table configurée')).toBeInTheDocument();
    expect(
      screen.getByText('Sélectionnez un élément pour modifier ses propriétés.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nouvelle table' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Table' })).not.toBeInTheDocument();
  });

  it('garde les outils du plan et la sauvegarde dans un seul bandeau', async () => {
    render(<FloorPlanCanvas orgId="org_test" mode="design" />);

    const saveButton = await screen.findByRole('button', { name: /Enregistrer/ });
    expect(saveButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan test/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Paramètres du plan' }));
    expect(
      await screen.findByRole('heading', { name: 'Paramètres de la salle' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(saveButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une salle' })).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /Historique/ })).toBeInTheDocument();
  });
});

describe("FloorPlanCanvas — liste d'attente Live service", () => {
  it('charge les entrées PENDING, les affiche dans Live service et les promeut', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [waitingListEntry];
      return floorPlan;
    });
    apiMocks.post.mockResolvedValue({ id: 'reservation-from-waiting-list' });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    fireEvent.click(await screen.findByRole('tab', { name: "Liste d'attente" }));

    expect(await screen.findByText('Alice Martin')).toBeInTheDocument();
    expect(screen.getByText('Terrasse')).toBeInTheDocument();
    expect(screen.getByText('4 couverts')).toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith(
      expect.stringMatching(/restaurants\/org_test\/waiting-list\?date=.*&status=PENDING/),
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Proposer une table' }));

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith(
        'restaurants/org_test/waiting-list/waiting-list-1/promote',
      );
    });
  });

  it('affiche le refus de promotion dans la carte concernée', () => {
    render(
      <WaitingListPanel
        entries={[waitingListEntry]}
        isLoading={false}
        promotingEntryId={null}
        entryErrors={{ 'waiting-list-1': 'Aucune table compatible' }}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.getByText('Aucune table compatible')).toBeInTheDocument();
  });
});

describe('FloorPlanCanvas — actions Live service', () => {
  function makeReservation(state: 'CONFIRMED' | 'SEATED'): PlanningReservation {
    const now = Date.now();
    return {
      id: `reservation-${state.toLowerCase()}`,
      tableId: 'table-t4-minimum-round',
      tableName: 'T4',
      sectionName: null,
      startsAt: new Date(now - 10 * 60_000).toISOString(),
      endsAt: new Date(now + 80 * 60_000).toISOString(),
      partySize: 4,
      customerName: 'Martin Dupont',
      state,
      seatedAt: state === 'SEATED' ? new Date(now - 10 * 60_000).toISOString() : null,
    };
  }

  it('place les onglets du service en tête sans bandeau de pouls', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [];
      if (path.includes('/service-copilot/pulse')) {
        return {
          date: '2026-07-22',
          generatedAt: '2026-07-22T17:30:00.000Z',
          isLiveDate: true,
          status: 'urgent',
          headline: '1 arrivée en retard à traiter',
          lateArrivals: 1,
          arrivalsToSeat: 2,
          arrivalsNext30Minutes: 3,
          seatedTables: 4,
          pendingWaitingList: 1,
          confirmedReservations: 9,
        };
      }
      return floorPlan;
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const tablist = await screen.findByRole('tablist', { name: 'Vue du service' });
    expect(tablist).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Pouls du service' })).not.toBeInTheDocument();
    // La vue service doit utiliser la même surface que les autres rubriques
    // (arrondis + bordure + fond carte) et non l'ancien rendu à plat.
    expect(tablist.closest('.sokar-card')).not.toBeNull();
  });

  it('expose les vues du service comme un véritable groupe d’onglets', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [];
      return floorPlan;
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const tablist = await screen.findByRole('tablist', { name: 'Vue du service' });
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Plan', "Liste d'attente", 'Statistiques']);
    expect(within(tablist).getByRole('tab', { name: 'Plan' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tablist).getByRole('tab', { name: 'Statistiques' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Statistiques' }));

    expect(within(tablist).getByRole('tab', { name: 'Statistiques' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tablist).getByRole('tab', { name: 'Plan' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('affiche la volumétrie du service et le taux d’occupation', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [makeReservation('SEATED')];
      if (path.includes('/waiting-list')) return [];
      if (path.includes('/service-copilot/pulse')) {
        return {
          date: '2026-09-18',
          generatedAt: '2026-09-18T17:30:00.000Z',
          isLiveDate: true,
          status: 'calm',
          headline: 'Service sous contrôle',
          lateArrivals: 0,
          arrivalsToSeat: 0,
          arrivalsNext30Minutes: 0,
          seatedTables: 1,
          pendingWaitingList: 0,
          confirmedReservations: 1,
        };
      }
      return floorPlan;
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const occupancy = await screen.findByRole('progressbar', { name: /Taux d’occupation/ });
    expect(occupancy).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('couverts')).toBeInTheDocument();
    expect(screen.getByText('tables occupées')).toBeInTheDocument();
    expect(screen.getByText('réservations')).toBeInTheDocument();
    expect(screen.getByText('Martin Dupont')).toBeInTheDocument();
    expect(screen.getAllByText('Occupée').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTitle('Occupée')).toBeInTheDocument();
  });

  it('signale une date passée et permet de revenir au jour courant', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [];
      if (path.includes('/service-copilot/pulse')) {
        return {
          date: '2026-09-18',
          generatedAt: '2026-09-18T17:30:00.000Z',
          isLiveDate: false,
          status: 'calm',
          headline: 'Service sous contrôle',
          lateArrivals: 0,
          arrivalsToSeat: 0,
          arrivalsNext30Minutes: 0,
          seatedTables: 0,
          pendingWaitingList: 0,
          confirmedReservations: 0,
        };
      }
      return floorPlan;
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const dateInput = await screen.findByLabelText('Date du service');
    fireEvent.change(dateInput, { target: { value: '2026-01-05' } });

    expect(await screen.findByText('Archive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aujourd’hui' }));

    expect(await screen.findByText('En direct')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aujourd’hui' })).not.toBeInTheDocument();
  });

  it('propose une sortie claire quand le plan Live ne contient aucune table', async () => {
    const onRequestEdit = vi.fn();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [];
      return { ...floorPlan, tables: [], walls: [], sections: [] };
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" onRequestEdit={onRequestEdit} />);

    expect(await screen.findByText('Aucune table dans ce plan')).toBeInTheDocument();
    expect(
      screen.getByText('Ajoutez vos tables depuis Plan visuel pour suivre le service ici.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Cliquez sur un élément de la palette, ou glissez-le ici.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Sélectionnez une table pour afficher la réservation et le temps d’occupation.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filtrer par serveur' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Configurer la salle' }));
    expect(onRequestEdit).toHaveBeenCalledOnce();
  });

  it('propose les affectations serveur sans afficher les options vides', async () => {
    const assignedPlan: FloorPlan = {
      ...floorPlan,
      tables: [
        { ...floorPlan.tables![0], assignedServer: 'Léa' },
        {
          ...floorPlan.tables![0],
          id: 'table-t2',
          name: 'T2',
          positionX: 180,
          assignedServer: null,
        },
      ],
    };
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [];
      if (path.includes('/service-copilot/delay-recoveries')) return { recoveries: [] };
      if (path.includes('/service-copilot/pulse')) {
        return {
          date: '2026-09-18',
          generatedAt: '2026-09-18T17:30:00.000Z',
          isLiveDate: true,
          status: 'calm',
          headline: 'Service sous contrôle',
          lateArrivals: 0,
          arrivalsToSeat: 0,
          arrivalsNext30Minutes: 0,
          seatedTables: 0,
          pendingWaitingList: 0,
          confirmedReservations: 0,
        };
      }
      return assignedPlan;
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const filter = await screen.findByRole('combobox', { name: 'Filtrer par serveur' });
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    try {
      fireEvent.click(filter);

      expect(await screen.findAllByText('Toutes les tables (2)')).not.toHaveLength(0);
      expect(screen.getAllByText('Non affectées (1)')).not.toHaveLength(0);
      expect(screen.getAllByText('Léa (1 table)')).not.toHaveLength(0);
    } finally {
      if (previousScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
          configurable: true,
          value: previousScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    }
  });

  it('emploie des actions métier explicites pour installer et libérer une table', async () => {
    let reservations = [makeReservation('CONFIRMED')];
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return reservations;
      if (path.includes('/waiting-list')) return [];
      return floorPlan;
    });

    const { unmount } = render(<FloorPlanCanvas orgId="org_test" mode="service" />);
    fireEvent.click(await screen.findByRole('button', { name: /Martin Dupont/ }));
    expect(await screen.findByRole('button', { name: 'Installer à table' })).toBeInTheDocument();
    unmount();

    reservations = [makeReservation('SEATED')];
    render(<FloorPlanCanvas orgId="org_test" mode="service" />);
    fireEvent.click(await screen.findByRole('button', { name: /Martin Dupont/ }));
    expect(await screen.findByRole('button', { name: 'Libérer la table' })).toBeInTheDocument();
  });

  it('affiche le retard vocal et son plan directement au-dessus du canevas', async () => {
    const reservation = makeReservation('CONFIRMED');
    const onInitialDelayApplied = vi.fn();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [reservation];
      if (path.includes('/waiting-list')) return [];
      return floorPlan;
    });
    apiMocks.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/service-copilot/delay-impact/revert')) {
        return {
          delayedReservationId: reservation.id,
          promotedReservationId: 'promoted-1',
          waitingListEntryId: 'waiting-list-2',
          operationId: 'delay-report-1',
        };
      }
      if (path.endsWith('/service-copilot/delay-impact/apply')) {
        return {
          delayedReservationId: reservation.id,
          promotedReservationId: 'promoted-1',
          operationId: 'delay-report-1',
        };
      }
      if (path.includes('/service-copilot/delay-impact')) {
        return {
          feasible: true,
          summary: 'Un plan sûr est disponible.',
          delayMinutes: 25,
          delayedReservation: {
            id: reservation.id,
            customerName: reservation.customerName,
            originalTableName: 'T4',
            originalStartsAt: reservation.startsAt,
            proposedStartsAt: reservation.startsAt,
          },
          alternativeTable: {
            id: 'table-12',
            name: 'T12',
            capacity: 4,
            sectionId: null,
          },
          waitingListEntry: {
            id: 'waiting-list-2',
            customerName: 'Alice Martin',
            partySize: 4,
            requestedStartsAt: reservation.startsAt,
            proposedStartsAt: reservation.startsAt,
            proposedEndsAt: reservation.endsAt,
            isAvailableNow: true,
          },
          safeguards: [],
        };
      }
      return {};
    });

    render(
      <FloorPlanCanvas
        orgId="org_test"
        mode="service"
        initialDelayImpact={{
          reservationId: reservation.id,
          delayMinutes: 25,
          delayReportId: 'delay-report-1',
        }}
        onInitialDelayApplied={onInitialDelayApplied}
      />,
    );

    expect(await screen.findByText('Martin Dupont · 4 pers. · +25 min')).toBeInTheDocument();
    expect(screen.getByLabelText('Retard annoncé en minutes')).toBeDisabled();
    expect(screen.getByText('Durée confirmée pendant l’appel client.')).toBeInTheDocument();
    expect(await screen.findByText('Disponible maintenant')).toBeInTheDocument();
    expect(screen.getByText('Liste d’attente')).toBeInTheDocument();
    expect(screen.getByText('Alice Martin n’avait pas encore de table.')).toBeInTheDocument();
    expect(screen.getByText('T12')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Retard signalé par téléphone' })).getByRole(
        'button',
        { name: 'Vérifier et appliquer' },
      ),
    );

    expect(
      await screen.findByText(/Aucun message n’est envoyé automatiquement/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Alice Martin est présent\(e\) et accepte la table proposée/),
    ).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Confirmer les changements' });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(/Alice Martin est présent\(e\) et accepte la table proposée/),
    );
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onInitialDelayApplied).toHaveBeenCalledTimes(1));
    expect(apiMocks.post).toHaveBeenCalledWith(
      'restaurants/org_test/service-copilot/delay-impact/apply',
      expect.objectContaining({
        reservationId: reservation.id,
        delayMinutes: 25,
        waitingListAcceptanceConfirmed: true,
        delayReportId: 'delay-report-1',
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('Communication requise')).toBeInTheDocument();
    expect(screen.getByText(/Alice Martin : liste d’attente → T4/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun message n’a été envoyé automatiquement/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annuler ce plan' }));
    expect(await screen.findByText('Annuler ce plan ?')).toBeInTheDocument();
    expect(
      screen.getByText(/Les communications déjà effectuées ne peuvent pas être annulées/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler ce plan' }),
    );

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'restaurants/org_test/service-copilot/delay-impact/revert',
        { reservationId: reservation.id, operationId: 'delay-report-1' },
      ),
    );
    expect(await screen.findByText('Plan initial restauré')).toBeInTheDocument();
    expect(screen.getByText(/Alice Martin retourne en liste d’attente/)).toBeInTheDocument();
  });

  it('retrouve un plan appliqué après actualisation et permet de l’annuler', async () => {
    const reservation = {
      ...makeReservation('CONFIRMED'),
      tableId: 'table-12',
      tableName: 'T12',
    };
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [reservation];
      if (path.includes('/waiting-list')) return [];
      if (path.includes('/service-copilot/delay-recoveries')) {
        return {
          recoveries: [
            {
              operationId: 'persisted-operation-1',
              delayedReservationId: reservation.id,
              promotedReservationId: 'promoted-1',
              waitingListEntryId: 'waiting-1',
              delayedCustomerName: 'Martin Dupont',
              waitingCustomerName: 'Alice Martin',
              originalTableName: 'T4',
              alternativeTableName: 'T12',
              delayMinutes: 25,
              originalStartsAt: reservation.startsAt,
              appliedStartsAt: reservation.startsAt,
              appliedAt: reservation.startsAt,
              status: 'applied',
              revertible: true,
            },
          ],
        };
      }
      return floorPlan;
    });
    apiMocks.post.mockResolvedValue({
      delayedReservationId: reservation.id,
      promotedReservationId: 'promoted-1',
      waitingListEntryId: 'waiting-1',
      operationId: 'persisted-operation-1',
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const history = await screen.findByRole('region', {
      name: 'Historique des plans de retard',
    });
    expect(within(history).getByText('Plans de retard')).toBeInTheDocument();
    expect(within(history).getByText(/Martin Dupont : T4 → T12/)).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'Annuler' }));
    expect(await screen.findByText('Annuler ce plan ?')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler ce plan' }),
    );

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'restaurants/org_test/service-copilot/delay-impact/revert',
        { reservationId: reservation.id, operationId: 'persisted-operation-1' },
      ),
    );
    expect(await screen.findByText('Plan initial restauré')).toBeInTheDocument();
  });

  it('explique dans l’historique pourquoi une annulation est bloquée', async () => {
    const reservation = makeReservation('CONFIRMED');
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [reservation];
      if (path.includes('/waiting-list')) return [];
      if (path.includes('/service-copilot/delay-recoveries')) {
        return {
          recoveries: [
            {
              operationId: 'blocked-operation-1',
              delayedReservationId: reservation.id,
              promotedReservationId: 'promoted-1',
              waitingListEntryId: 'waiting-1',
              delayedCustomerName: 'Martin Dupont',
              waitingCustomerName: 'Alice Martin',
              originalTableName: 'T4',
              alternativeTableName: 'T12',
              delayMinutes: 25,
              originalStartsAt: reservation.startsAt,
              appliedStartsAt: reservation.startsAt,
              appliedAt: reservation.startsAt,
              status: 'blocked',
              revertible: false,
              blockedReason: 'Le groupe promu a déjà été modifié ou installé.',
            },
          ],
        };
      }
      return floorPlan;
    });

    render(<FloorPlanCanvas orgId="org_test" mode="service" />);

    const history = await screen.findByRole('region', {
      name: 'Historique des plans de retard',
    });
    expect(within(history).getByText('À vérifier')).toBeInTheDocument();
    expect(
      within(history).getByText('Le groupe promu a déjà été modifié ou installé.'),
    ).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
  });

  it('invalide immédiatement un plan si la durée du retard change', async () => {
    const reservation = makeReservation('CONFIRMED');
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [reservation];
      if (path.includes('/waiting-list')) return [];
      return floorPlan;
    });
    apiMocks.post.mockResolvedValue({
      feasible: true,
      summary: 'Plan calculé pour 25 minutes.',
      delayMinutes: 25,
      alternativeTable: { id: 'table-12', name: 'T12', capacity: 4, sectionId: null },
      waitingListEntry: {
        id: 'waiting-list-2',
        customerName: 'Alice Martin',
        partySize: 4,
        requestedStartsAt: reservation.startsAt,
        proposedStartsAt: reservation.startsAt,
        proposedEndsAt: reservation.endsAt,
        isAvailableNow: true,
      },
      safeguards: [],
    });

    render(
      <FloorPlanCanvas
        orgId="org_test"
        mode="service"
        initialDelayImpact={{ reservationId: reservation.id, delayMinutes: 25 }}
      />,
    );

    expect(await screen.findByText('Plan calculé pour 25 minutes.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Retard annoncé en minutes'), {
      target: { value: '40' },
    });
    expect(screen.queryByText('Plan calculé pour 25 minutes.')).not.toBeInTheDocument();
    expect(screen.queryByText('Disponible maintenant')).not.toBeInTheDocument();
  });

  it('analyse un second retard reçu sans remonter le composant', async () => {
    const first = makeReservation('CONFIRMED');
    const second = {
      ...first,
      id: 'reservation-second',
      customerName: 'Deuxième Client',
    };
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [first, second];
      if (path.includes('/waiting-list')) return [];
      return floorPlan;
    });
    apiMocks.post.mockResolvedValue({
      feasible: false,
      summary: 'Aucun plan.',
      delayMinutes: 20,
      safeguards: [],
    });

    const { rerender } = render(
      <FloorPlanCanvas
        orgId="org_test"
        mode="service"
        initialDelayImpact={{ reservationId: first.id, delayMinutes: 20 }}
      />,
    );
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'restaurants/org_test/service-copilot/delay-impact',
        { reservationId: first.id, delayMinutes: 20 },
      ),
    );

    rerender(
      <FloorPlanCanvas
        orgId="org_test"
        mode="service"
        initialDelayImpact={{ reservationId: second.id, delayMinutes: 30 }}
      />,
    );
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'restaurants/org_test/service-copilot/delay-impact',
        { reservationId: second.id, delayMinutes: 30 },
      ),
    );
  });

  it('explique clairement quand la réservation signalée est absente de la date', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/floor-plan/reservations')) return [];
      if (path.includes('/waiting-list')) return [];
      return floorPlan;
    });

    render(
      <FloorPlanCanvas
        orgId="org_test"
        mode="service"
        initialDelayImpact={{ reservationId: 'missing', delayMinutes: 20 }}
      />,
    );

    expect(
      await screen.findByText(/La réservation signalée n’est pas visible pour cette date/),
    ).toBeInTheDocument();
    expect(apiMocks.post).not.toHaveBeenCalled();
  });
});

describe('StatsPanel — alertes', () => {
  const liveDate = '2025-06-10';
  const allTables = floorPlan.tables as unknown as Parameters<typeof StatsPanel>[0]['allTables'];

  function renderStats(reservations: PlanningReservation[]) {
    return render(
      <StatsPanel
        reservations={reservations}
        allTables={allTables}
        tableStatuses={new Map() as Parameters<typeof StatsPanel>[0]['tableStatuses']}
        liveDate={liveDate}
      />,
    );
  }

  it('affiche une alerte pour une réservation legacy sans tableId', () => {
    const reservations: PlanningReservation[] = [
      {
        id: 'res-legacy',
        tableId: null,
        tableName: null,
        sectionName: null,
        startsAt: '2025-06-10T18:00:00',
        endsAt: '2025-06-10T19:00:00',
        partySize: 4,
        customerName: 'Jean Dupont',
        state: 'CONFIRMED',
        seatedAt: null,
      },
    ];

    renderStats(reservations);

    expect(screen.getByText('1 réservation sans table')).toBeInTheDocument();
    expect(screen.getByText(/Jean Dupont/)).toBeInTheDocument();
  });

  it('affiche une alerte de surcapacité quand les couverts dépassent la capacité totale', () => {
    const reservations: PlanningReservation[] = [
      {
        id: 'res-big',
        tableId: 'table-t4-minimum-round',
        tableName: 'T4',
        sectionName: null,
        startsAt: '2025-06-10T19:00:00',
        endsAt: '2025-06-10T19:15:00',
        partySize: 6,
        customerName: 'Marie Martin',
        state: 'CONFIRMED',
        seatedAt: null,
      },
    ];

    renderStats(reservations);

    expect(screen.getByText('Surcapacité détectée')).toBeInTheDocument();
    expect(screen.getAllByText('19:00')).toHaveLength(2);
    expect(screen.getByText('6 / 4')).toBeInTheDocument();
  });

  it("ne déclenche pas l'alerte legacy sans tableId pour une réservation CANCELLED", () => {
    const reservations: PlanningReservation[] = [
      {
        id: 'res-cancelled',
        tableId: null,
        tableName: null,
        sectionName: null,
        startsAt: '2025-06-10T18:00:00',
        endsAt: '2025-06-10T19:00:00',
        partySize: 4,
        customerName: 'Alice Cancel',
        state: 'CANCELLED',
        seatedAt: null,
      },
    ];

    renderStats(reservations);

    expect(screen.queryByText(/réservation sans table/)).not.toBeInTheDocument();
    expect(screen.getByText('Aucune alerte.')).toBeInTheDocument();
  });

  it("ne déclenche pas l'alerte legacy sans tableId pour une réservation NO_SHOW", () => {
    const reservations: PlanningReservation[] = [
      {
        id: 'res-no-show',
        tableId: null,
        tableName: null,
        sectionName: null,
        startsAt: '2025-06-10T18:00:00',
        endsAt: '2025-06-10T19:00:00',
        partySize: 4,
        customerName: 'Bob NoShow',
        state: 'NO_SHOW',
        seatedAt: null,
      },
    ];

    renderStats(reservations);

    expect(screen.queryByText(/réservation sans table/)).not.toBeInTheDocument();
    expect(screen.getByText('Aucune alerte.')).toBeInTheDocument();
  });

  it('ne compte pas une réservation CANCELLED dans la surcapacité', () => {
    const reservations: PlanningReservation[] = [
      {
        id: 'res-cancelled-big',
        tableId: 'table-t4-minimum-round',
        tableName: 'T4',
        sectionName: null,
        startsAt: '2025-06-10T19:00:00',
        endsAt: '2025-06-10T19:15:00',
        partySize: 6,
        customerName: 'Marie Annulée',
        state: 'CANCELLED',
        seatedAt: null,
      },
    ];

    renderStats(reservations);

    expect(screen.queryByText('Surcapacité détectée')).not.toBeInTheDocument();
    expect(screen.getByText('Aucune alerte.')).toBeInTheDocument();
  });

  it('affiche le texte pluriel pour plusieurs réservations legacy sans tableId', () => {
    const reservations: PlanningReservation[] = [
      {
        id: 'res-legacy-1',
        tableId: null,
        tableName: null,
        sectionName: null,
        startsAt: '2025-06-10T18:00:00',
        endsAt: '2025-06-10T18:30:00',
        partySize: 1,
        customerName: 'Alice One',
        state: 'CONFIRMED',
        seatedAt: null,
      },
      {
        id: 'res-legacy-2',
        tableId: null,
        tableName: null,
        sectionName: null,
        startsAt: '2025-06-10T20:00:00',
        endsAt: '2025-06-10T20:30:00',
        partySize: 1,
        customerName: 'Bob Two',
        state: 'CONFIRMED',
        seatedAt: null,
      },
    ];

    renderStats(reservations);

    expect(screen.getByText('2 réservations sans table')).toBeInTheDocument();
    expect(screen.getByText(/Alice One/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Two/)).toBeInTheDocument();
  });
});

describe('FloorPlanCanvas — cadrage tactile et gestes', () => {
  it('cadre le plan dans la fenêtre visible sans descendre sous le plancher tactile', () => {
    // Salle 1400 × 900 dans la fenêtre d'un iPhone 13 : le cadrage strict
    // donnerait 0,26, soit des tables plus petites que la cible tactile.
    expect(
      computeFitZoom({
        viewportWidth: 358,
        viewportHeight: 420,
        canvasWidth: 1400,
        canvasHeight: 900,
        minZoom: 0.3,
        floor: 0.45,
      }),
    ).toBeCloseTo(0.45, 5);

    // Un petit plan tient entièrement : le plancher ne le dégrade pas.
    expect(
      computeFitZoom({
        viewportWidth: 358,
        viewportHeight: 420,
        canvasWidth: 640,
        canvasHeight: 480,
        minZoom: 0.3,
        floor: 0.45,
      }),
    ).toBeCloseTo(358 / 640, 5);
  });

  it('borne le zoom et refuse un cadrage sur une fenêtre non mesurée', () => {
    expect(clampZoom(0.05, 0.3)).toBe(0.3);
    expect(clampZoom(4, 0.3)).toBe(2);
    expect(
      computeFitZoom({
        viewportWidth: 0,
        viewportHeight: 0,
        canvasWidth: 1400,
        canvasHeight: 900,
        minZoom: 0.3,
      }),
    ).toBe(0.3);
  });

  it('calcule la zone occupée par les tables posées', () => {
    expect(
      computeContentBounds(
        [
          { positionX: 100, positionY: 200, width: 144, height: 104, rotation: 0 },
          { positionX: 400, positionY: 300, width: 128, height: 128, shape: 'round', rotation: 0 },
          { positionX: null, positionY: null },
        ],
        1400,
        900,
      ),
    ).toEqual({
      x: 52,
      y: 152,
      width: 524,
      height: 324,
    });

    // Aucune table posée : pas de zone, le cadrage retombe sur le plan entier.
    expect(computeContentBounds([{ positionX: null, positionY: null }], 1400, 900)).toBeNull();
  });

  it("tient compte de la rotation pour l'empreinte au sol", () => {
    // 144 × 104 tourné à 90° pivote autour du centre : l'empreinte devient
    // 104 × 144, ancrée au coin supérieur gauche d'origine.
    expect(
      computeContentBounds(
        [{ positionX: 100, positionY: 100, width: 144, height: 104, rotation: 90 }],
        1400,
        900,
      ),
    ).toEqual({
      x: 72,
      y: 32,
      width: 200,
      height: 240,
    });
  });

  it('cadre en Live les tables sans reprendre la hauteur vide de la zone', () => {
    expect(
      computeLiveContentBounds(
        [{ x: 100, y: 120, width: 500, height: 300, rotation: 0 }],
        [{ positionX: 180, positionY: 180, width: 64, height: 64, rotation: 0 }],
        1400,
        900,
      ),
    ).toEqual({ x: 156, y: 156, width: 112, height: 112 });
  });

  it('centre la zone des tables dans la fenêtre', () => {
    expect(
      computeFocusScroll({
        viewportWidth: 358,
        viewportHeight: 420,
        region: { x: 400, y: 300, width: 400, height: 300 },
        zoom: 1,
      }),
    ).toEqual({ left: 421, top: 240 });

    // Zone déjà visible : le défilement reste borné à zéro.
    expect(
      computeFocusScroll({
        viewportWidth: 358,
        viewportHeight: 420,
        region: { x: 52, y: 152, width: 524, height: 324 },
        zoom: 0.45,
      }),
    ).toEqual({ left: 0, top: 0 });
  });

  it('garde le point touché immobile pendant un changement d’échelle', () => {
    const anchor = computeZoomAnchorScroll({
      scrollLeft: 100,
      scrollTop: 50,
      offsetX: 40,
      offsetY: 30,
      zoom: 1,
      nextZoom: 2,
    });

    // Le point du plan sous le doigt (140, 80 en coordonnées plan) reste
    // sous le doigt : (scroll + offset) / zoom est invariant.
    expect((anchor.left + 40) / 2).toBeCloseTo(140, 5);
    expect((anchor.top + 30) / 2).toBeCloseTo(80, 5);
  });

  describe('FloorPlanCanvas — vue service sur téléphone', () => {
    function calmPulse(overrides: Partial<Record<string, number>> = {}) {
      return {
        date: '2026-09-18',
        generatedAt: '2026-09-18T17:30:00.000Z',
        isLiveDate: true,
        status: 'calm' as const,
        headline: 'Service sous contrôle',
        lateArrivals: 0,
        arrivalsToSeat: 0,
        arrivalsNext30Minutes: 0,
        seatedTables: 0,
        pendingWaitingList: 0,
        confirmedReservations: 0,
        ...overrides,
      };
    }

    function mockServicePulse(pulse: ReturnType<typeof calmPulse>, reservations: unknown[]) {
      apiMocks.get.mockImplementation(async (path: string) => {
        if (path.includes('/floor-plan/reservations')) return reservations;
        if (path.includes('/waiting-list')) return [];
        if (path.includes('/service-copilot/delay-recoveries')) return { recoveries: [] };
        if (path.includes('/service-copilot/pulse')) return pulse;
        return floorPlan;
      });
    }

    it('réduit le cockpit à une ligne et cadre le plan quand le service est vide', async () => {
      mediaMocks.mobile = true;
      mediaMocks.touch = true;
      mediaMocks.coarse = true;
      mockServicePulse(calmPulse(), []);

      // Fenêtre utile d'un iPhone 13 dans le plan de salle.
      const widthSpy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(358);
      const heightSpy = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(420);
      try {
        render(<FloorPlanCanvas orgId="org_test" mode="service" />);

        // La navigation remplace désormais le bandeau d'état compact.
        expect(await screen.findByRole('tablist', { name: 'Vue du service' })).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Pouls du service' })).not.toBeInTheDocument();
        // Ni volumétrie à zéro ni jauge ne mangent la hauteur utile du plan.
        expect(screen.queryByText('couverts')).not.toBeInTheDocument();
        expect(
          screen.queryByRole('progressbar', { name: /Taux d’occupation/ }),
        ).not.toBeInTheDocument();

        // Le plan s'ouvre cadré sur la zone des tables, sans exposer de
        // contrôle de zoom au service : Live est une vue finalisée.
        expect(await screen.findByRole('button', { name: 'T4 · 4 places' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Zoom arrière' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Zoom avant' })).not.toBeInTheDocument();
        await waitFor(() =>
          expect(screen.getByTestId('floor-plan-live-stage')).toHaveStyle({ width: '224px' }),
        );

        // Le canvas recouvre l'espaceur qui fournit l'aire de défilement. S'il
        // n'est pas ancré en haut à gauche, sa position statique le place après
        // l'espaceur et crée précisément le grand vide vu au-dessus des tables.
        const table = screen.getByRole('button', { name: 'T4 · 4 places' });
        expect(table.closest('.origin-top-left')).toHaveClass('left-0', 'top-0');
      } finally {
        widthSpy.mockRestore();
        heightSpy.mockRestore();
      }
    });

    it('garde le cockpit complet dès qu’une action est en attente', async () => {
      mediaMocks.mobile = true;
      mediaMocks.touch = true;
      mockServicePulse(calmPulse({ pendingWaitingList: 2 }), []);

      render(<FloorPlanCanvas orgId="org_test" mode="service" />);

      expect(await screen.findByText('couverts')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: /Taux d’occupation/ })).toBeInTheDocument();
      expect(
        screen.queryByText('Service en direct · Aucune réservation aujourd’hui'),
      ).not.toBeInTheDocument();
    });

    it('recadre chaque plan au premier affichage', async () => {
      mediaMocks.mobile = true;
      mediaMocks.touch = true;
      mediaMocks.coarse = true;
      let activePlan = floorPlan;
      apiMocks.get.mockImplementation(async (path: string) => {
        if (path.includes('/floor-plan/reservations')) return [];
        if (path.includes('/waiting-list')) return [];
        if (path.includes('/service-copilot/delay-recoveries')) return { recoveries: [] };
        if (path.includes('/service-copilot/pulse')) return calmPulse();
        return activePlan;
      });

      const widthSpy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(358);
      const heightSpy = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(420);
      try {
        const { rerender } = render(<FloorPlanCanvas orgId="org_test" mode="service" />);

        expect(await screen.findByRole('button', { name: 'T4 · 4 places' })).toBeInTheDocument();
        activePlan = { ...floorPlan, id: 'floor-plan-terrace', name: 'Terrasse' };
        rerender(
          <FloorPlanCanvas orgId="org_test" mode="service" floorPlanId="floor-plan-terrace" />,
        );

        expect(await screen.findByRole('button', { name: 'T4 · 4 places' })).toBeInTheDocument();
        await waitFor(() =>
          expect(screen.getByTestId('floor-plan-live-stage')).toHaveStyle({ width: '224px' }),
        );
      } finally {
        widthSpy.mockRestore();
        heightSpy.mockRestore();
      }
    });
  });

  it('centre le plan sans jamais produire de défilement négatif', () => {
    expect(
      computeCenterScroll({
        viewportWidth: 400,
        viewportHeight: 300,
        canvasWidth: 1400,
        canvasHeight: 900,
        zoom: 0.5,
      }),
    ).toEqual({ left: 150, top: 75 });
    expect(
      computeCenterScroll({
        viewportWidth: 800,
        viewportHeight: 600,
        canvasWidth: 700,
        canvasHeight: 420,
        zoom: 1,
      }),
    ).toEqual({ left: 0, top: 0 });
  });

  it('reconnaît un double-tap proche dans le temps et l’espace', () => {
    const first = { time: 1000, x: 40, y: 60 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { time: 1200, x: 50, y: 66 })).toBe(true);
    expect(isDoubleTap(first, { time: 1500, x: 50, y: 66 })).toBe(false);
    expect(isDoubleTap(first, { time: 1200, x: 140, y: 66 })).toBe(false);
  });
});
