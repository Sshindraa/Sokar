import { db } from '../../shared/db/client';
import { THEFORK_COMMISSION_PER_PAX } from '@callyx/config';

export interface RoiReport {
  period:            string;
  totalReservations: number;
  totalCouverts:     number;
  estimatedRevenue:  number;
  theforkSavings:    number;
  callyxMonthlyCost: number;
  roiMultiplier:     number;
}

const PLAN_PRICES: Record<string, number> = {
  STARTER: 89,
  PRO:     179,
  PREMIUM: 299,
};

export async function computeRoi(restaurantId: string, period: string): Promise<RoiReport> {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 0, 23, 59, 59, 999);

  const [restaurant, reservations] = await Promise.all([
    db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } }),
    db.reservation.findMany({
      where: {
        restaurantId,
        status:    'CONFIRMED',
        createdAt: { gte: start, lte: end },
      },
    }),
  ]);

  const totalCouverts    = reservations.reduce((s: number, r: any) => s + r.partySize, 0);
  const estimatedRevenue = reservations.reduce((s: number, r: any) => s + Number(r.estimatedRevenue ?? 0), 0);
  const theforkSavings   = totalCouverts * THEFORK_COMMISSION_PER_PAX;
  const monthlyCost      = PLAN_PRICES[restaurant.plan] ?? 89;

  return {
    period,
    totalReservations: reservations.length,
    totalCouverts,
    estimatedRevenue,
    theforkSavings,
    callyxMonthlyCost: monthlyCost,
    roiMultiplier: monthlyCost > 0 ? Math.round((theforkSavings / monthlyCost) * 10) / 10 : 0,
  };
}
