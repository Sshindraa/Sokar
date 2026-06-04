import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { logger } from '../../shared/logger/pino';

export interface CreateReservationInput {
  restaurantId:   string;
  callId?:        string;
  reservedAt:     Date;
  partySize:      number;
  customerName:   string;
  customerPhone?: string;
}

export class ReservationService {
  static async create(input: CreateReservationInput) {
    const reservation = await db.reservation.create({
      data: {
        restaurantId:     input.restaurantId,
        callId:           input.callId,
        reservedAt:       input.reservedAt,
        partySize:        input.partySize,
        customerName:     input.customerName,
        customerPhone:    input.customerPhone,
        status:           'CONFIRMED',
        estimatedRevenue: input.partySize * 35,
      },
    });

    // Enqueue SMS de confirmation au client si numéro fourni et toggle active
    if (input.customerPhone) {
      try {
        const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: input.restaurantId } });
        if (restaurant.smsConfirmEnabled) {
          await queues.smsClient.add('client-confirm', {
            reservationId:  reservation.id,
            customerPhone:  input.customerPhone,
            customerName:   input.customerName,
            restaurantName: restaurant.name,
            date: input.reservedAt.toLocaleDateString('fr-FR'),
            time: input.reservedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            partySize: input.partySize,
          });
        }
      } catch (err) {
        logger.error({ err }, '[ReservationService] Failed to enqueue SMS confirmation');
      }
    }

    return reservation;
  }

  static async findByRestaurant(restaurantId: string, date?: string) {
    const where: any = { restaurantId };
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      where.reservedAt = { gte: start, lte: end };
    }
    return db.reservation.findMany({ where, orderBy: { reservedAt: 'asc' } });
  }
}
