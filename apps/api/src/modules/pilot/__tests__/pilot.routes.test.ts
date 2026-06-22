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
    (db.reservation.count as any) = vi
      .fn()
      .mockResolvedValueOnce(150) // total
      .mockResolvedValueOnce(100) // honored
      .mockResolvedValueOnce(20) // pending
      .mockResolvedValueOnce(15) // cancelled
      .mockResolvedValueOnce(15); // no_show

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
    (db.reservation.count as any) = vi.fn().mockRejectedValueOnce(new Error('DB down'));

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/internal/pilot-kpis' });
    expect(res.statusCode).toBe(500);
  });
});
