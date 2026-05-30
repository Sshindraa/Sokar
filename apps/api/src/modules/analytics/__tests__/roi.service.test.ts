import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../../shared/db/client', () => ({
  db: {
    restaurant: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'r1', plan: 'STARTER' }),
    },
    reservation: {
      findMany: vi.fn().mockResolvedValue([
        { partySize: 2, estimatedRevenue: 70 },
        { partySize: 3, estimatedRevenue: 105 },
      ]),
    },
  },
}));

describe('computeRoi', () => {
  it('calcule les économies TheFork correctement', async () => {
    const { computeRoi } = await import('../roi.service');
    const roi = await computeRoi('r1', '2026-05');
    expect(roi.totalCouverts).toBe(5);
    expect(roi.theforkSavings).toBe(15);
    expect(roi.sokarMonthlyCost).toBe(149);
    expect(roi.roiMultiplier).toBe(0.1);
    expect(roi.estimatedRevenue).toBe(175);
  });
});
