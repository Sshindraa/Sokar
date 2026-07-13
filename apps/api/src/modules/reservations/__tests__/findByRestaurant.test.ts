import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationService } from '../reservation.service';
import { db } from '../../../shared/db/client';

vi.mock('../../../shared/db/client', () => ({
  db: {
    reservation: {
      findMany: vi.fn(),
    },
  },
}));

describe('ReservationService.findByRestaurant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('retourne les réservations triées par heure pour un restaurant', async () => {
    const restaurantId = 'rest-123';
    const mockReservations = [
      { id: 'r1', reservedAt: new Date('2099-06-05T19:00:00'), partySize: 2 },
      { id: 'r2', reservedAt: new Date('2099-06-05T20:00:00'), partySize: 4 },
    ];

    vi.mocked(db.reservation.findMany).mockResolvedValue(
      mockReservations as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>,
    );

    const result = await ReservationService.findByRestaurant(restaurantId);

    expect(db.reservation.findMany).toHaveBeenCalledWith({
      where: { restaurantId },
      orderBy: { reservedAt: 'asc' },
    });
    expect(result).toEqual(mockReservations);
  });

  it("filtre par date quand un 'date' est fourni (fenêtre 00:00 → 23:59:59.999)", async () => {
    const restaurantId = 'rest-123';
    const date = '2099-06-05';
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);

    await ReservationService.findByRestaurant(restaurantId, date);

    const call = vi.mocked(db.reservation.findMany).mock.calls[0][0] as any;
    expect(call.where.restaurantId).toBe(restaurantId);
    expect(call.where.reservedAt.gte).toBeInstanceOf(Date);
    expect(call.where.reservedAt.lte).toBeInstanceOf(Date);
    // Sanity: borne inférieure = minuit, borne supérieure = fin de journée
    expect(call.where.reservedAt.gte.getHours()).toBe(0);
    expect(call.where.reservedAt.gte.getMinutes()).toBe(0);
    expect(call.where.reservedAt.lte.getHours()).toBe(23);
    expect(call.where.reservedAt.lte.getMinutes()).toBe(59);
    expect(call.where.reservedAt.lte.getMilliseconds()).toBe(999);
  });

  it("ne filtre pas par date quand 'date' est omis", async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);

    await ReservationService.findByRestaurant('rest-123');

    const call = vi.mocked(db.reservation.findMany).mock.calls[0][0] as any;
    expect(call.where.reservedAt).toBeUndefined();
    expect(call.where).toEqual({ restaurantId: 'rest-123' });
  });
});
