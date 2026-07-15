import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FloorPlanCanvas } from './FloorPlanCanvas';
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
  tables: [],
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
    expect(await screen.findByText('Aligné')).toBeInTheDocument();

    const snappedWall = container.querySelector('line[x1="300"][x2="480"]');
    expect(snappedWall).toBeInTheDocument();
  });
});
