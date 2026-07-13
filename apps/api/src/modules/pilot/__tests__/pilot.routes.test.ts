import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('Pilot routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/internal/pilot-kpis retourne les KPIs', async () => {
    vi.mocked(db.reservation.groupBy).mockResolvedValue([
      { state: 'HONORED', _count: { state: 100 } },
      { state: 'PENDING', _count: { state: 20 } },
      { state: 'CANCELLED', _count: { state: 15 } },
      { state: 'NO_SHOW', _count: { state: 15 } },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.groupBy>>);

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/internal/pilot-kpis' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timestamp).toBeDefined();
    expect(body.reservationsTotal).toBe(150);
    expect(body.reservationsHonored).toBe(100);
    expect(body.slos).toBeDefined();
    expect(body.health).toBeDefined();
  });

  it('retourne 500 si la DB plante', async () => {
    vi.mocked(db.reservation.groupBy).mockRejectedValueOnce(new Error('DB down'));

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/internal/pilot-kpis' });
    expect(res.statusCode).toBe(500);
  });
});
