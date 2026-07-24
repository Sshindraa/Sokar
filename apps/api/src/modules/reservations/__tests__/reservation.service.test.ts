import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';
import { ReservationService } from '../reservation.service';
import { GoogleCalendarClient } from '../../../shared/google-calendar/client';

vi.mock('../../../shared/db/client', () => {
  const mockDb = {
    restaurant: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    restaurantExposureSettings: {
      findUnique: vi.fn(),
    },
    reservation: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    floorPlan: {
      findFirst: vi.fn().mockResolvedValue({ id: 'fp-1' }),
    },
    table: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'table-1', floorPlanId: 'fp-1', capacity: 4, minCapacity: 1, isActive: true },
        ]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    agenticHold: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(mockDb)),
  } as unknown as PrismaClient;

  return { db: mockDb };
});

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

const mockRestaurant = {
  id: 'rest-123',
  name: 'Chez Test',
  smsConfirmEnabled: true,
  googleRefreshToken: null,
  googleCalendarId: null,
  timezone: 'Europe/Paris',
  openingHours: {
    mon: { open: '12:00', close: '23:00' },
    tue: { open: '12:00', close: '23:00' },
    wed: { open: '12:00', close: '23:00' },
    thu: { open: '12:00', close: '23:00' },
    fri: { open: '12:00', close: '23:00' },
    sat: { open: '12:00', close: '23:00' },
    sun: { open: '12:00', close: '23:00' },
  },
  exposureSettings: {
    capacitySpecials: null,
  },
};

function makeInput(overrides: Partial<Parameters<typeof ReservationService.create>[0]> = {}) {
  return {
    restaurantId: 'rest-123',
    callId: 'leg-1',
    reservedAt: new Date('2099-06-05T19:00:00'),
    partySize: 4,
    customerName: 'Alice',
    customerPhone: '+33612345678',
    ...overrides,
  };
}

describe('ReservationService.create - replay-safe (idempotent on callId)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
    vi.mocked(db.agenticHold.findMany).mockResolvedValue([]);
    vi.mocked(db.floorPlan.findFirst).mockResolvedValue({ id: 'fp-1' } as unknown as Awaited<
      ReturnType<typeof db.floorPlan.findFirst>
    >);
    vi.mocked(db.table.findMany).mockResolvedValue([
      { id: 'table-1', floorPlanId: 'fp-1', capacity: 4, minCapacity: 1, isActive: true },
    ] as unknown as Awaited<ReturnType<typeof db.table.findMany>>);
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(
      mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>,
    );
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: 'locked' }] as unknown as Awaited<
      ReturnType<typeof db.$queryRaw>
    >);
  });

  it('create : retourne la réservation existante si callId déjà présent (replay-safe)', async () => {
    const existing = {
      id: 'res-existing',
      restaurantId: 'rest-123',
      callId: 'leg-1',
      reservedAt: new Date('2099-06-05T19:00:00'),
      partySize: 4,
      customerName: 'Alice',
      customerPhone: '+33612345678',
      status: 'CONFIRMED',
      googleEventId: 'event-old',
    };

    vi.mocked(db.reservation.findUnique).mockResolvedValue(
      existing as unknown as Awaited<ReturnType<typeof db.reservation.findUnique>>,
    );

    const result = await ReservationService.create(makeInput({ callId: 'leg-1' }));

    expect(result).toBe(existing);
    expect(db.reservation.findUnique).toHaveBeenCalledWith({ where: { callId: 'leg-1' } });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(queues.smsClient.add).not.toHaveBeenCalled();
  });

  it('create : skip replay-safe si callId absent (chemin normal)', async () => {
    const mockReservation = {
      id: 'res-new',
      restaurantId: 'rest-123',
      reservedAt: new Date('2099-06-05T19:00:00'),
      partySize: 4,
      customerName: 'Alice',
      customerPhone: '+33612345678',
      googleEventId: null,
    };

    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(db.reservation.create).mockResolvedValue(
      mockReservation as unknown as Awaited<ReturnType<typeof db.reservation.create>>,
    );

    const result = await ReservationService.create(makeInput({ callId: undefined }));

    // Le check replay-safe ne doit pas être appelé quand callId est absent.
    expect(db.reservation.findUnique).not.toHaveBeenCalled();
    // Le chemin de création normal est emprunté.
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.reservation.create).toHaveBeenCalled();
    expect(result.id).toBe('res-new');
  });

  it('create : P2002 race ultra-étroite → rollback la transaction (pas de leak de table)', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );

    // Premier findUnique (replay-safe check externe) retourne null.
    vi.mocked(db.reservation.findUnique).mockResolvedValueOnce(null);
    // Double-check inside la transaction retourne null aussi (la race se
    // produit entre le double-check et le create).
    vi.mocked(db.reservation.findUnique).mockResolvedValueOnce(null);
    // Le create lève P2002 (un autre tx a inséré dans la fenêtre étroite).
    vi.mocked(db.reservation.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'reservation_callId_key' },
      }),
    );

    await expect(ReservationService.create(makeInput({ callId: 'leg-race' }))).rejects.toThrow(
      'Unique constraint failed',
    );
    expect(db.reservation.create).toHaveBeenCalled();
  });

  it('create : double-check in transaction trouve existing → skip table allocation', async () => {
    const existing = {
      id: 'res-dbl',
      restaurantId: 'rest-123',
      callId: 'leg-dbl',
      reservedAt: new Date('2099-06-05T19:00:00'),
      partySize: 4,
      customerName: 'Alice',
      customerPhone: '+33612345678',
      status: 'CONFIRMED',
      googleEventId: null,
    };

    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );

    // Premier findUnique (check externe) retourne null : on entre dans la tx.
    vi.mocked(db.reservation.findUnique).mockResolvedValueOnce(null);
    // Double-check inside la transaction trouve la réservation existante
    // (un autre tx a committé entre le check externe et la transaction).
    vi.mocked(db.reservation.findUnique).mockResolvedValueOnce(
      existing as unknown as Awaited<ReturnType<typeof db.reservation.findUnique>>,
    );

    const result = await ReservationService.create(makeInput({ callId: 'leg-dbl' }));

    expect(result).toBe(existing);
    // La table n'est pas allouée, le create n'est pas appelé.
    expect(db.reservation.create).not.toHaveBeenCalled();
  });
});
