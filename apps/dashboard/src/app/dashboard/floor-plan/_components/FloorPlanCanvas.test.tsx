import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FloorPlanCanvas,
  getChairPositions,
  getSafeTableDimensions,
  StatsPanel,
  TABLE_LAYOUT,
} from './FloorPlanCanvas';
import type { FloorPlan, FloorPlanWall, PlanningReservation } from '@/types/api';

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

vi.mock('@/lib/api', () => ({
  useApi: () => apiMocks,
}));

beforeEach(() => {
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

describe('FloorPlanCanvas — taille des tables', () => {
  it('keeps a minimum-size round T4 card shrinkable to its explicit dimensions', async () => {
    render(<FloorPlanCanvas orgId="org_test" />);

    const table = await screen.findByRole('button', { name: 'T4 · 4 places' });

    expect(table).toHaveClass('min-w-0', 'min-h-0');
    expect(table).toHaveStyle({ width: '64px', height: '64px' });

    const tableName = screen.getByText('T4');
    const capacity = screen.getByText('· 4 places');

    expect(tableName.parentElement).toHaveClass('min-w-0', 'flex-wrap');
    expect(tableName).toHaveClass('min-w-0');
    expect(capacity).toHaveClass('min-w-0');
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
    apiMocks.patch.mockImplementation(async (_path: string, body: FloorPlanWall) => body);
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
