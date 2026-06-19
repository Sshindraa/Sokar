import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationService } from '../reservation.service';
import { db } from '../../../shared/db/client';
import { GoogleCalendarClient } from '../../../shared/google-calendar/client';

vi.mock('../../../shared/db/client', () => ({
  db: {
    restaurant: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    reservation: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/google-calendar/client', () => ({
  GoogleCalendarClient: {
    checkAvailability: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  },
}));

vi.mock('../../../shared/queue/queues', () => ({
  queues: {
    smsClient: {
      add: vi.fn(),
    },
  },
}));

describe('ReservationService - Google Calendar Sync', () => {
  const mockRestaurant = {
    id: 'rest-123',
    name: 'Chez Test',
    smsConfirmEnabled: true,
    googleRefreshToken: 'refresh-token-xyz',
    googleCalendarId: 'primary',
    openingHours: {
      mon: { open: '12:00', close: '23:00' },
      tue: { open: '12:00', close: '23:00' },
      wed: { open: '12:00', close: '23:00' },
      thu: { open: '12:00', close: '23:00' },
      fri: { open: '12:00', close: '23:00' },
      sat: { open: '12:00', close: '23:00' },
      sun: { open: '12:00', close: '23:00' },
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
  });

  describe('create', () => {
    it('should throw SLOT_NOT_AVAILABLE and not create anything if calendar is busy', async () => {
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(mockRestaurant as any);
      vi.mocked(GoogleCalendarClient.checkAvailability).mockResolvedValue(false);

      const input = {
        restaurantId: 'rest-123',
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+33612345678',
      };

      await expect(ReservationService.create(input)).rejects.toThrow('SLOT_NOT_AVAILABLE');

      expect(GoogleCalendarClient.checkAvailability).toHaveBeenCalled();
      expect(db.reservation.create).not.toHaveBeenCalled();
      expect(GoogleCalendarClient.createEvent).not.toHaveBeenCalled();
    });

    it('should create reservation and sync to Google Calendar if available', async () => {
      const mockReservation = {
        id: 'res-456',
        restaurantId: 'rest-123',
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+33612345678',
        googleEventId: null,
      };

      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(mockRestaurant as any);
      vi.mocked(GoogleCalendarClient.checkAvailability).mockResolvedValue(true);
      vi.mocked(db.reservation.create).mockResolvedValue(mockReservation as any);
      vi.mocked(GoogleCalendarClient.createEvent).mockResolvedValue('event-789');
      vi.mocked(db.reservation.update).mockResolvedValue({
        ...mockReservation,
        googleEventId: 'event-789',
      } as any);

      const input = {
        restaurantId: 'rest-123',
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+33612345678',
      };

      const result = await ReservationService.create(input);

      expect(db.reservation.create).toHaveBeenCalled();
      expect(GoogleCalendarClient.createEvent).toHaveBeenCalledWith(
        'refresh-token-xyz',
        'primary',
        expect.objectContaining({
          summary: 'Réservation Sokar - Alice',
        }),
      );
      expect(db.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-456' },
        data: { googleEventId: 'event-789' },
      });
      expect(result.googleEventId).toBe('event-789');
    });

    it('should create reservation locally even if Google credentials are not set', async () => {
      const restaurantNoGoogle = {
        ...mockRestaurant,
        googleRefreshToken: null,
        googleCalendarId: null,
      };

      const mockReservation = {
        id: 'res-456',
        restaurantId: 'rest-123',
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+33612345678',
        googleEventId: null,
      };

      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(restaurantNoGoogle as any);
      vi.mocked(db.reservation.create).mockResolvedValue(mockReservation as any);

      const input = {
        restaurantId: 'rest-123',
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+33612345678',
      };

      const result = await ReservationService.create(input);

      expect(GoogleCalendarClient.checkAvailability).not.toHaveBeenCalled();
      expect(db.reservation.create).toHaveBeenCalled();
      expect(GoogleCalendarClient.createEvent).not.toHaveBeenCalled();
      expect(result.googleEventId).toBeNull();
    });
  });

  describe('update', () => {
    it('should update reservation and update Google event if not cancelled', async () => {
      const mockReservationWithRest = {
        id: 'res-456',
        googleEventId: 'event-789',
        restaurant: mockRestaurant,
      };

      const updatedReservation = {
        id: 'res-456',
        customerName: 'Alice Updated',
        partySize: 6,
        customerPhone: '+33612345678',
        status: 'CONFIRMED',
        googleEventId: 'event-789',
        reservedAt: new Date('2099-06-05T19:00:00'),
      };

      vi.mocked(db.reservation.findUniqueOrThrow).mockResolvedValue(mockReservationWithRest as any);
      vi.mocked(db.reservation.update).mockResolvedValue(updatedReservation as any);

      const result = await ReservationService.update('res-456', 'rest-123', {
        customerName: 'Alice Updated',
        partySize: 6,
      });

      expect(db.reservation.update).toHaveBeenCalled();
      expect(GoogleCalendarClient.updateEvent).toHaveBeenCalledWith(
        'refresh-token-xyz',
        'primary',
        'event-789',
        expect.objectContaining({
          summary: 'Réservation Sokar - Alice Updated (CONFIRMED)',
        }),
      );
      expect(result.customerName).toBe('Alice Updated');
    });

    it('should delete Google event and clear googleEventId if status is CANCELLED', async () => {
      const mockReservationWithRest = {
        id: 'res-456',
        googleEventId: 'event-789',
        restaurant: mockRestaurant,
      };

      const updatedReservation = {
        id: 'res-456',
        status: 'CANCELLED',
        googleEventId: 'event-789',
        reservedAt: new Date('2099-06-05T19:00:00'),
      };

      vi.mocked(db.reservation.findUniqueOrThrow).mockResolvedValue(mockReservationWithRest as any);
      // First update sets to CANCELLED
      vi.mocked(db.reservation.update)
        .mockResolvedValueOnce(updatedReservation as any)
        // Second update clears googleEventId
        .mockResolvedValueOnce({
          ...updatedReservation,
          googleEventId: null,
        } as any);

      await ReservationService.update('res-456', 'rest-123', {
        status: 'CANCELLED',
      });

      expect(GoogleCalendarClient.deleteEvent).toHaveBeenCalledWith(
        'refresh-token-xyz',
        'primary',
        'event-789',
      );
      expect(db.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-456' },
        data: { googleEventId: null },
      });
    });
  });

  describe('delete', () => {
    it('should delete Google event and delete reservation locally', async () => {
      const mockReservationWithRest = {
        id: 'res-456',
        googleEventId: 'event-789',
        restaurant: mockRestaurant,
      };

      vi.mocked(db.reservation.findUniqueOrThrow).mockResolvedValue(mockReservationWithRest as any);

      await ReservationService.delete('res-456', 'rest-123');

      expect(GoogleCalendarClient.deleteEvent).toHaveBeenCalledWith(
        'refresh-token-xyz',
        'primary',
        'event-789',
      );
      expect(db.reservation.delete).toHaveBeenCalledWith({
        where: { id: 'res-456', restaurantId: 'rest-123' },
      });
    });
  });

  describe('availability', () => {
    it('should return only calendar-available slots', async () => {
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(mockRestaurant as any);
      vi.mocked(GoogleCalendarClient.checkAvailability).mockImplementation(
        async (_refreshToken, _calendarId, start) => start.getMinutes() !== 30,
      );

      const result = await ReservationService.availability('rest-123', '2099-06-05', 2);

      expect(result.slots).toContain('12:00');
      expect(result.slots).not.toContain('12:30');
      expect(result.allSlots.find((slot) => slot.time === '12:30')).toMatchObject({
        available: false,
        reason: 'calendar_conflict',
      });
    });

    it('should reject create outside opening hours', async () => {
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(mockRestaurant as any);

      await expect(
        ReservationService.create({
          restaurantId: 'rest-123',
          reservedAt: new Date('2099-06-05T10:00:00'),
          partySize: 2,
          customerName: 'Alice',
        }),
      ).rejects.toThrow('SLOT_NOT_AVAILABLE');

      expect(db.reservation.create).not.toHaveBeenCalled();
      expect(GoogleCalendarClient.checkAvailability).not.toHaveBeenCalled();
    });
  });
});
