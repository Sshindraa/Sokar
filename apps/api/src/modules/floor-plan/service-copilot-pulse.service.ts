import type { PrismaClient } from '@prisma/client';
import { zonedTimeToUtc } from './availability-capacity-aware.service';

export type ServiceCopilotPulseStatus = 'calm' | 'attention' | 'urgent';

export type ServiceCopilotPulse = {
  date: string;
  generatedAt: string;
  isLiveDate: boolean;
  status: ServiceCopilotPulseStatus;
  headline: string;
  lateArrivals: number;
  arrivalsToSeat: number;
  arrivalsNext30Minutes: number;
  seatedTables: number;
  pendingWaitingList: number;
  confirmedReservations: number;
};

function formatLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Résumé opérationnel, calculé serveur pour que toute l'équipe lise le même
 * état du service. Il est strictement en lecture seule et ne remplace jamais
 * les vérifications transactionnelles des actions Copilot.
 */
export class ServiceCopilotPulseService {
  constructor(private readonly prisma: PrismaClient) {}

  async getPulse(args: {
    restaurantId: string;
    date: string;
    now?: Date;
  }): Promise<ServiceCopilotPulse> {
    const now = args.now ?? new Date();
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: args.restaurantId },
      select: { timezone: true },
    });
    const timeZone = restaurant?.timezone ?? 'Europe/Paris';
    const dayStart = zonedTimeToUtc(args.date, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(args.date, '23:59', timeZone);
    const isLiveDate = formatLocalDate(now, timeZone) === args.date;
    const lateThreshold = new Date(now.getTime() - 15 * 60_000);
    const nextThirtyMinutes = new Date(now.getTime() + 30 * 60_000);

    const [
      confirmedReservations,
      seatedReservations,
      pendingWaitingList,
      lateArrivals,
      arrivalsToSeat,
      arrivalsNext30Minutes,
    ] = await Promise.all([
      this.prisma.reservation.count({
        where: {
          restaurantId: args.restaurantId,
          state: 'CONFIRMED',
          startsAt: { gte: dayStart, lte: dayEnd },
        },
      }),
      this.prisma.reservation.findMany({
        where: {
          restaurantId: args.restaurantId,
          state: 'SEATED',
          startsAt: { gte: dayStart, lte: dayEnd },
          tableId: { not: null },
        },
        distinct: ['tableId'],
        select: { tableId: true },
      }),
      this.prisma.waitingListEntry.count({
        where: {
          restaurantId: args.restaurantId,
          status: 'PENDING',
          slotStart: { gte: dayStart, lte: dayEnd },
          expiresAt: { gt: now },
        },
      }),
      isLiveDate
        ? this.prisma.reservation.count({
            where: {
              restaurantId: args.restaurantId,
              state: 'CONFIRMED',
              startsAt: { gte: dayStart, lt: lateThreshold },
            },
          })
        : Promise.resolve(0),
      isLiveDate
        ? this.prisma.reservation.count({
            where: {
              restaurantId: args.restaurantId,
              state: 'CONFIRMED',
              startsAt: { gte: dayStart, lte: now },
            },
          })
        : Promise.resolve(0),
      isLiveDate
        ? this.prisma.reservation.count({
            where: {
              restaurantId: args.restaurantId,
              state: 'CONFIRMED',
              startsAt: { gt: now, lte: nextThirtyMinutes },
            },
          })
        : Promise.resolve(0),
    ]);

    const status: ServiceCopilotPulseStatus =
      lateArrivals > 0
        ? 'urgent'
        : arrivalsToSeat > 0 || pendingWaitingList > 0
          ? 'attention'
          : 'calm';
    const headline = !isLiveDate
      ? `${plural(confirmedReservations, 'réservation')} ${
          confirmedReservations === 1 ? 'confirmée' : 'confirmées'
        } sur ce service`
      : lateArrivals > 0
        ? `${plural(lateArrivals, 'arrivée')} en retard à traiter`
        : arrivalsToSeat > 0
          ? `${plural(arrivalsToSeat, 'arrivée')} à installer`
          : pendingWaitingList > 0
            ? `${plural(pendingWaitingList, 'groupe')} en liste d’attente`
            : 'Service sous contrôle';

    return {
      date: args.date,
      generatedAt: now.toISOString(),
      isLiveDate,
      status,
      headline,
      lateArrivals,
      arrivalsToSeat,
      arrivalsNext30Minutes,
      seatedTables: seatedReservations.length,
      pendingWaitingList,
      confirmedReservations,
    };
  }
}
