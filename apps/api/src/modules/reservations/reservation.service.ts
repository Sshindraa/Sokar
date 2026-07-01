import { db } from '../../shared/db/client';
import type { Prisma, Restaurant } from '@prisma/client';
import { queues } from '../../shared/queue/queues';
import { logger } from '../../shared/logger/pino';
import { GoogleCalendarClient } from '../../shared/google-calendar/client';
import { ACTIVE_RESERVATION_STATUSES } from '@sokar/shared';

const SLOT_STEP_MINUTES = 30;
const RESERVATION_DURATION_MINUTES = 120;

export interface CreateReservationInput {
  restaurantId: string;
  callId?: string;
  reservedAt: Date;
  partySize: number;
  customerName: string;
  customerPhone?: string;
}

interface OpeningSlot {
  open: string;
  close: string;
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

function parseLocalDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function dayKey(date: Date): string {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
}

function getOpeningSlot(openingHours: unknown, date: Date): OpeningSlot | null {
  if (!openingHours || typeof openingHours !== 'object' || Array.isArray(openingHours)) return null;
  const slot = (openingHours as Record<string, OpeningSlot | null>)[dayKey(date)];
  if (!slot?.open || !slot?.close) return null;
  return slot;
}

function buildOpeningSlots(openingHours: unknown, date: string): Date[] {
  const day = parseLocalDateTime(date, '00:00');
  const slot = getOpeningSlot(openingHours, day);
  if (!slot) return [];

  const start = parseLocalDateTime(date, slot.open);
  const end = parseLocalDateTime(date, slot.close);
  const slots: Date[] = [];
  const current = new Date(start);
  while (current < end) {
    slots.push(new Date(current));
    current.setMinutes(current.getMinutes() + SLOT_STEP_MINUTES);
  }
  return slots;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export class ReservationService {
  static async create(input: CreateReservationInput) {
    const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: input.restaurantId } });

    const startTime = input.reservedAt;
    const availability = await this.checkSlotAvailability(restaurant, startTime, input.partySize);

    if (!availability.available) {
      logger.warn(
        { restaurantId: input.restaurantId, time: startTime, reason: availability.reason },
        '[ReservationService] Slot unavailable',
      );
      throw new Error('SLOT_NOT_AVAILABLE');
    }

    // 2. Create reservation locally
    const reservation = await db.reservation.create({
      data: {
        restaurantId: input.restaurantId,
        callId: input.callId,
        reservedAt: input.reservedAt,
        partySize: input.partySize,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        status: 'CONFIRMED',
        estimatedRevenue: input.partySize * 35,
      },
    });

    // 3. Create Google Calendar event and store event ID
    if (restaurant.googleRefreshToken && restaurant.googleCalendarId) {
      try {
        const endTime = new Date(startTime.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000);
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
    const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const candidates = buildOpeningSlots(restaurant.openingHours, date);

    const allSlots = await Promise.all(
      candidates.map(async (slotStart) => {
        const result = await this.checkSlotAvailability(restaurant, slotStart, partySize);
        return {
          time: timeKey(slotStart),
          available: result.available,
          ...(result.reason && { reason: result.reason }),
        };
      }),
    );

    return {
      restaurantId,
      date,
      partySize,
      slots: allSlots.filter((slot) => slot.available).map((slot) => slot.time),
      allSlots,
    };
  }

  private static async checkSlotAvailability(
    restaurant: Restaurant,
    startTime: Date,
    _partySize: number,
  ): Promise<{ available: boolean; reason?: AvailabilitySlot['reason'] }> {
    if (Number.isNaN(startTime.getTime())) {
      return { available: false, reason: 'closed' };
    }

    if (startTime.getTime() <= Date.now()) {
      return { available: false, reason: 'past' };
    }

    const date = dateKey(startTime);
    const openingSlots = buildOpeningSlots(restaurant.openingHours, date);
    const isWithinService = openingSlots.some((slot) => slot.getTime() === startTime.getTime());
    if (!isWithinService) {
      return { available: false, reason: 'closed' };
    }

    const endTime = new Date(startTime.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000);
    const dayStart = parseLocalDateTime(date, '00:00');
    const dayEnd = parseLocalDateTime(date, '23:59');

    const localReservations = await db.reservation.findMany({
      where: {
        restaurantId: restaurant.id,
        status: { in: [...ACTIVE_RESERVATION_STATUSES] },
        reservedAt: { gte: dayStart, lte: dayEnd },
      },
      select: { reservedAt: true },
    });

    const hasLocalConflict = localReservations.some((reservation: { reservedAt: Date }) => {
      const reservedStart = new Date(reservation.reservedAt);
      const reservedEnd = new Date(
        reservedStart.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000,
      );
      return overlaps(startTime, endTime, reservedStart, reservedEnd);
    });
    if (hasLocalConflict) {
      return { available: false, reason: 'local_conflict' };
    }

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
