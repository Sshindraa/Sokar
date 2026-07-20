import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FloorPlanCanvas,
  getChairPositions,
  getSafeTableDimensions,
  TABLE_LAYOUT,
} from './FloorPlanCanvas';
import type { FloorPlan, FloorPlanWall } from '@/types/api';

const patchWall = vi.fn();

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
  useApi: () => ({
    get: vi.fn(async (path: string) => {
      if (path.includes('/reservations')) return [];
      return floorPlan;
    }),
    post: vi.fn(),
    patch: patchWall,
    del: vi.fn(),
  }),
}));

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
});

describe('FloorPlanCanvas — guides des murs', () => {
  beforeEach(() => {
    patchWall.mockReset();
    patchWall.mockImplementation(async (_path: string, body: FloorPlanWall) => body);
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
