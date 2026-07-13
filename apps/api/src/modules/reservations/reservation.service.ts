import { db } from '../../shared/db/client';
import type { Prisma, Restaurant } from '@prisma/client';
import { queues } from '../../shared/queue/queues';
import { logger } from '../../shared/logger/pino';
import { GoogleCalendarClient } from '../../shared/google-calendar/client';
import { CapacityAwareAvailabilityService } from '../floor-plan/availability-capacity-aware.service';
import { TableAllocationService } from '../floor-plan/table-allocation.service';
import { resolveServiceDurationMinutes } from '../floor-plan/floor-plan.types';

const availability = new CapacityAwareAvailabilityService(db);
const tableAllocation = new TableAllocationService(db);

export interface CreateReservationInput {
  restaurantId: string;
  callId?: string;
  reservedAt: Date;
  partySize: number;
  customerName: string;
  customerPhone?: string;
}

interface AvailabilitySlot {
  time: string;
  available: boolean;
  reason?: 'closed' | 'past' | 'local_conflict' | 'calendar_conflict';
}

export interface AvailabilityResult {
  restaurantId: string;
  date: string;
  partySize: number;
  slots: string[];
  allSlots: AvailabilitySlot[];
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export class ReservationService {
  static async create(input: CreateReservationInput) {
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: input.restaurantId },
      include: { exposureSettings: true },
    });

    const startTime = input.reservedAt;
    const serviceDurationMinutes = resolveServiceDurationMinutes(
      restaurant.exposureSettings?.capacitySpecials,
    );
    const endTime = new Date(startTime.getTime() + serviceDurationMinutes * 60 * 1000);

    const slotAvailability = await this.checkSlotAvailability(
      restaurant,
      startTime,
      input.partySize,
    );

    if (!slotAvailability.available) {
      logger.warn(
        { restaurantId: input.restaurantId, time: startTime, reason: slotAvailability.reason },
        '[ReservationService] Slot unavailable',
      );
      throw new Error('SLOT_NOT_AVAILABLE');
    }

    // 2. Allouer et créer la réservation dans une transaction pour éviter
    //    l'allocation concurrente de la même table.
    const reservation = await db.$transaction(async (tx) => {
      const table = await tableAllocation.allocate(
        {
          restaurantId: input.restaurantId,
          partySize: input.partySize,
          startsAt: startTime,
          endsAt: endTime,
        },
        tx,
      );
      if (!table) {
        logger.warn(
          { restaurantId: input.restaurantId, time: startTime, partySize: input.partySize },
          '[ReservationService] No table available',
        );
        throw new Error('SLOT_NOT_AVAILABLE');
      }

      return tx.reservation.create({
        data: {
          restaurantId: input.restaurantId,
          callId: input.callId,
          reservedAt: input.reservedAt,
          startsAt: input.reservedAt,
          endsAt: endTime,
          partySize: input.partySize,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          status: 'CONFIRMED',
          tableId: table.id,
          estimatedRevenue: input.partySize * 35,
        },
      });
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
          },
        );

        await db.reservation.update({
          where: { id: reservation.id, restaurantId: input.restaurantId },
          data: { googleEventId: eventId },
        });

        reservation.googleEventId = eventId;
      } catch (err: unknown) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), reservationId: reservation.id },
          '[ReservationService] Failed to sync to Google Calendar',
        );
      }
    }

    // 4. Enqueue SMS confirmation to client
    if (input.customerPhone) {
      try {
        if (restaurant.smsConfirmEnabled) {
          await queues.smsClient.add('client-confirm', {
            reservationId: reservation.id,
            customerPhone: input.customerPhone,
            customerName: input.customerName,
            restaurantName: restaurant.name,
            date: input.reservedAt.toLocaleDateString('fr-FR'),
            time: input.reservedAt.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            partySize: input.partySize,
          });
        }
      } catch (err) {
        logger.error({ err }, '[ReservationService] Failed to enqueue SMS confirmation');
      }
    }

    await CapacityAwareAvailabilityService.invalidateAvailability(input.restaurantId);
    return reservation;
  }

  static async update(id: string, restaurantId: string, data: Prisma.ReservationUpdateInput) {
    const reservation = await db.reservation.findUniqueOrThrow({
      where: { id, restaurantId },
      include: { restaurant: true },
    });

    const updated = await db.reservation.update({
      where: { id, restaurantId },
      data,
    });

    // Sync updates to Google Calendar
    if (
      reservation.restaurant.googleRefreshToken &&
      reservation.restaurant.googleCalendarId &&
      updated.googleEventId
    ) {
      try {
        if (updated.status === 'CANCELLED') {
          await GoogleCalendarClient.deleteEvent(
            reservation.restaurant.googleRefreshToken,
            reservation.restaurant.googleCalendarId,
            updated.googleEventId,
          );

          await db.reservation.update({
            where: { id, restaurantId },
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
            },
          );
        }
      } catch (err: unknown) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), reservationId: id },
          '[ReservationService] Failed to update Google Calendar event',
        );
      }
    }

    await CapacityAwareAvailabilityService.invalidateAvailability(restaurantId);
    return updated;
  }

  static async delete(id: string, restaurantId: string) {
    const reservation = await db.reservation.findUniqueOrThrow({
      where: { id, restaurantId },
      include: { restaurant: true },
    });

    // Delete Google Calendar event if it exists
    if (
      reservation.restaurant.googleRefreshToken &&
      reservation.restaurant.googleCalendarId &&
      reservation.googleEventId
    ) {
      try {
        await GoogleCalendarClient.deleteEvent(
          reservation.restaurant.googleRefreshToken,
          reservation.restaurant.googleCalendarId,
          reservation.googleEventId,
        );
      } catch (err: unknown) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), reservationId: id },
          '[ReservationService] Failed to delete Google Calendar event',
        );
      }
    }

    await db.reservation.delete({ where: { id, restaurantId } });
    await CapacityAwareAvailabilityService.invalidateAvailability(restaurantId);
  }

  static async findByRestaurant(restaurantId: string, date?: string) {
    const where: Prisma.ReservationWhereInput = { restaurantId };
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      where.reservedAt = { gte: start, lte: end };
    }
    return db.reservation.findMany({ where, orderBy: { reservedAt: 'asc' } });
  }

  static async availability(
    restaurantId: string,
    date: string,
    partySize: number,
  ): Promise<AvailabilityResult> {
    const dto = await availability.getAvailability({ restaurantId, date, partySize });
    return {
      restaurantId: dto.restaurantId,
      date: dto.date,
      partySize: dto.partySize,
      slots: dto.slots.filter((slot) => slot.available).map((slot) => slot.time),
      allSlots: dto.slots,
    };
  }

  private static async checkSlotAvailability(
    restaurant: Restaurant & { exposureSettings?: { capacitySpecials: unknown } | null },
    startTime: Date,
    partySize: number,
  ): Promise<{ available: boolean; reason?: AvailabilitySlot['reason'] }> {
    if (Number.isNaN(startTime.getTime())) {
      return { available: false, reason: 'closed' };
    }

    if (startTime.getTime() <= Date.now()) {
      return { available: false, reason: 'past' };
    }

    const date = dateKey(startTime);
    const dto = await availability.getAvailability({
      restaurantId: restaurant.id,
      date,
      partySize,
    });

    const time = timeKey(startTime);
    const slot = dto.slots.find((s) => s.time === time);
    if (!slot) {
      return { available: false, reason: 'closed' };
    }
    if (!slot.available) {
      return { available: false, reason: 'local_conflict' };
    }

    const serviceDurationMinutes = resolveServiceDurationMinutes(
      restaurant.exposureSettings?.capacitySpecials,
    );
    const endTime = new Date(startTime.getTime() + serviceDurationMinutes * 60 * 1000);

    if (restaurant.googleRefreshToken && restaurant.googleCalendarId) {
      const isAvailable = await GoogleCalendarClient.checkAvailability(
        restaurant.googleRefreshToken,
        restaurant.googleCalendarId,
        startTime,
        endTime,
      );

      if (!isAvailable) {
        return { available: false, reason: 'calendar_conflict' };
      }
    }

    return { available: true };
  }
}
