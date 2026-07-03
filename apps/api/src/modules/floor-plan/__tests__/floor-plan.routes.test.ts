/**
 * Tests d'intégration des routes admin du plan de salle.
 *
 * Vérifie le CRUD sections/tables et la récupération du floor plan.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer fake-token' };
const RESTAURANT_ID = 'test-rest-1';

describe('admin /restaurants/:id/floor-plan routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.floorPlan.findUnique).mockResolvedValue({
      id: 'fp-1',
      name: 'Salle principale',
      restaurantId: RESTAURANT_ID,
      sections: [],
      tables: [],
    } as any);
    vi.mocked(db.section.findFirst).mockResolvedValue({
      id: 'sec-1',
      name: 'Terrasse',
      position: 0,
      floorPlanId: 'fp-1',
    } as any);
    vi.mocked(db.table.findFirst).mockResolvedValue({
      id: 'table-1',
      name: 'T1',
      capacity: 4,
      minCapacity: 1,
      isActive: true,
      floorPlanId: 'fp-1',
    } as any);
  });

  it('retourne 401 sans auth', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/floor-plan`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('récupère le floor plan avec sections et tables', async () => {
    const floorPlanId = 'fp-1';
    vi.mocked(db.floorPlan.findUnique).mockResolvedValue({
      id: floorPlanId,
      name: 'Salle principale',
      restaurantId: RESTAURANT_ID,
      sections: [
        {
          id: 'sec-1',
          name: 'Terrasse',
          position: 0,
          floorPlanId,
          tables: [
            {
              id: 'table-1',
              name: 'T1',
              capacity: 4,
              minCapacity: 1,
              isActive: true,
              positionX: 0,
              positionY: 0,
              shape: 'round',
            },
          ],
        },
      ],
      tables: [],
    } as any);
    vi.mocked(db.section.findMany).mockResolvedValue([
      {
        id: 'sec-1',
        name: 'Terrasse',
        position: 0,
        floorPlanId,
        tables: [
          {
            id: 'table-1',
            name: 'T1',
            capacity: 4,
            minCapacity: 1,
            isActive: true,
            positionX: 0,
            positionY: 0,
            shape: 'round',
          },
        ],
      },
    ] as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/floor-plan`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(floorPlanId);
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].tables[0].name).toBe('T1');
  });

  it('crée une section', async () => {
    vi.mocked(db.section.create).mockResolvedValue({
      id: 'sec-2',
      name: 'Salle intérieure',
      position: 1,
      floorPlanId: 'fp-1',
    } as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/restaurants/${RESTAURANT_ID}/floor-plan/sections`,
      headers: AUTH,
      payload: { name: 'Salle intérieure' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Salle intérieure');
  });

  it('crée une table', async () => {
    vi.mocked(db.table.create).mockResolvedValue({
      id: 'table-2',
      name: 'T2',
      capacity: 2,
      minCapacity: 1,
      isActive: true,
    } as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/restaurants/${RESTAURANT_ID}/floor-plan/tables`,
      headers: AUTH,
      payload: { sectionId: 'sec-1', name: 'T2', capacity: 2 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('T2');
  });

  it('met à jour le statut actif d une table', async () => {
    vi.mocked(db.table.update).mockResolvedValue({
      id: 'table-1',
      name: 'T1',
      capacity: 4,
      isActive: false,
    } as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/restaurants/${RESTAURANT_ID}/floor-plan/tables/table-1`,
      headers: AUTH,
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isActive).toBe(false);
  });
});
