import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { logger } from '../../shared/logger/pino';
import { GoogleCalendarClient } from '../../shared/google-calendar/client';

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
    const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: input.restaurantId } });

    const startTime = input.reservedAt;
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // Default duration 2 hours

    // 1. Google Calendar conflict check
    if (restaurant.googleRefreshToken && restaurant.googleCalendarId) {
      const isAvailable = await GoogleCalendarClient.checkAvailability(
        restaurant.googleRefreshToken,
        restaurant.googleCalendarId,
        startTime,
        endTime
      );

      if (!isAvailable) {
        logger.warn({ restaurantId: input.restaurantId, time: startTime }, '[ReservationService] Calendar conflict detected');
        throw new Error('SLOT_NOT_AVAILABLE');
      }
    }

    // 2. Create reservation locally
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

    // 3. Create Google Calendar event and store event ID
    if (restaurant.googleRefreshToken && restaurant.googleCalendarId) {
      try {
        const eventId = await GoogleCalendarClient.createEvent(
          restaurant.googleRefreshToken,
          restaurant.googleCalendarId,
          {
            start: startTime,
            end: endTime,
            summary: `Réservation Sokar - ${input.customerName}`,
            description: `Couverts: ${input.partySize}\nTéléphone: ${input.customerPhone || 'non fourni'}\nCréée automatiquement par l'assistant vocal Sokar.`,
          }
        );

        await db.reservation.update({
          where: { id: reservation.id },
          data: { googleEventId: eventId },
        });

        reservation.googleEventId = eventId;
      } catch (err: any) {
        logger.error({ err: err.message, reservationId: reservation.id }, '[ReservationService] Failed to sync to Google Calendar');
      }
    }

    // 4. Enqueue SMS confirmation to client
    if (input.customerPhone) {
      try {
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

  static async update(id: string, restaurantId: string, data: any) {
    const reservation = await db.reservation.findUniqueOrThrow({
      where: { id, restaurantId },
      include: { restaurant: true },
    });

    const updated = await db.reservation.update({
      where: { id, restaurantId },
      data,
    });

    // Sync updates to Google Calendar
    if (reservation.restaurant.googleRefreshToken && reservation.restaurant.googleCalendarId && updated.googleEventId) {
      try {
        if (updated.status === 'CANCELLED') {
          await GoogleCalendarClient.deleteEvent(
            reservation.restaurant.googleRefreshToken,
            reservation.restaurant.googleCalendarId,
            updated.googleEventId
          );
          
          await db.reservation.update({
            where: { id },
            data: { googleEventId: null },
          });
          
          updated.googleEventId = null;
        } else {
          const startTime = updated.reservedAt;
          const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
          
          await GoogleCalendarClient.updateEvent(
            reservation.restaurant.googleRefreshToken,
            reservation.restaurant.googleCalendarId,
            updated.googleEventId,
            {
              start: startTime,
              end: endTime,
              summary: `Réservation Sokar - ${updated.customerName} (${updated.status})`,
              description: `Couverts: ${updated.partySize}\nTéléphone: ${updated.customerPhone || 'non fourni'}\nStatut mis à jour sur le dashboard.`,
            }
          );
        }
      } catch (err: any) {
        logger.error({ err: err.message, reservationId: id }, '[ReservationService] Failed to update Google Calendar event');
      }
    }

    return updated;
  }

  static async delete(id: string, restaurantId: string) {
    const reservation = await db.reservation.findUniqueOrThrow({
      where: { id, restaurantId },
      include: { restaurant: true },
    });

    // Delete Google Calendar event if it exists
    if (reservation.restaurant.googleRefreshToken && reservation.restaurant.googleCalendarId && reservation.googleEventId) {
      try {
        await GoogleCalendarClient.deleteEvent(
          reservation.restaurant.googleRefreshToken,
          reservation.restaurant.googleCalendarId,
          reservation.googleEventId
        );
      } catch (err: any) {
        logger.error({ err: err.message, reservationId: id }, '[ReservationService] Failed to delete Google Calendar event');
      }
    }

    await db.reservation.delete({ where: { id, restaurantId } });
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
