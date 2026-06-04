import { db } from '../../shared/db/client';
import { THEFORK_COMMISSION_PER_PAX, DEFAULT_AVERAGE_TICKET, PLAN_PRICE_MAP } from '@sokar/config';

export interface RoiReport {
  period:            string;
  totalReservations: number;
  totalCouverts:     number;
  estimatedRevenue:  number;
  theforkSavings:    number;
  sokarMonthlyCost: number;
  roiMultiplier:     number;
}

const PLAN_PRICES: Record<string, number> = PLAN_PRICE_MAP;

export async function computeRoi(restaurantId: string, period: string): Promise<RoiReport> {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 0, 23, 59, 59, 999);

  const [restaurant, reservations] = await Promise.all([
    db.restaurant.findUnique({ where: { id: restaurantId } }),
    db.reservation.findMany({
      where: {
        restaurantId,
        status:    'CONFIRMED',
        createdAt: { gte: start, lte: end },
      },
    }),
  ]);

  if (!restaurant) {
    return {
      period,
      totalReservations: 0,
      totalCouverts: 0,
      estimatedRevenue: 0,
      theforkSavings: 0,
      sokarMonthlyCost: PLAN_PRICES['STARTER'] ?? 149,
      roiMultiplier: 0,
    };
  }

  const totalCouverts = reservations.reduce((s: number, r: any) => s + r.partySize, 0);

  // estimatedRevenue from DB if available, else fallback to partySize * DEFAULT_AVERAGE_TICKET
  const estimatedRevenue = reservations.reduce((s: number, r: any) => {
    const rev = Number(r.estimatedRevenue ?? 0);
    return s + (rev > 0 ? rev : r.partySize * DEFAULT_AVERAGE_TICKET);
  }, 0);

  const theforkSavings = totalCouverts * THEFORK_COMMISSION_PER_PAX;
  const monthlyCost    = PLAN_PRICES[restaurant.plan] ?? 149;

  return {
    period,
    totalReservations: reservations.length,
    totalCouverts,
    estimatedRevenue: Math.round(estimatedRevenue),
    theforkSavings,
    sokarMonthlyCost: monthlyCost,
    roiMultiplier: monthlyCost > 0 ? Math.round((theforkSavings / monthlyCost) * 10) / 10 : 0,
  };
}
