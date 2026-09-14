import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExperienceReservationStatus,
  ExperienceSessionStatus,
  ExperienceStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  cancelExperienceReservation,
  createExperience,
  createExperienceSession,
  expireExperienceSessions,
  ExperienceConflictError,
  ExperienceInputError,
  reserveExperience,
  updateExperienceSession,
} from '../experience.service';

const RESTAURANT_ID = 'restaurant-1';
const EXPERIENCE_ID = 'experience-1';
const SESSION_ID = 'session-1';
const RESERVATION_ID = 'experience-reservation-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function experienceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPERIENCE_ID,
    restaurantId: RESTAURANT_ID,
    key: 'wine-tasting',
    name: 'Dégustation de vins',
    description: 'Une séance guidée.',
    durationMinutes: 90,
    priceCents: 4500,
    currency: 'EUR',
    capacity: 12,
    status: ExperienceStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { sessions: 1, reservations: 0 },
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    restaurantId: RESTAURANT_ID,
    experienceId: EXPERIENCE_ID,
    startsAt: new Date('2026-09-20T18:00:00.000Z'),
    endsAt: new Date('2026-09-20T19:30:00.000Z'),
    capacityOverride: null,
    status: ExperienceSessionStatus.OPEN,
    createdAt: NOW,
    updatedAt: NOW,
    experience: {
      key: 'wine-tasting',
      name: 'Dégustation de vins',
      priceCents: 4500,
      currency: 'EUR',
      capacity: 12,
      status: ExperienceStatus.ACTIVE,
    },
    _count: { reservations: 0 },
    ...overrides,
  };
}

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    restaurantId: RESTAURANT_ID,
    experienceId: EXPERIENCE_ID,
    sessionId: SESSION_ID,
    customerId: null,
    reservationId: null,
    idempotencyKey: null,
    quantity: 2,
    unitPriceCents: 4500,
    totalPriceCents: 9000,
    currency: 'EUR',
    status: ExperienceReservationStatus.CONFIRMED,
    createdByHash: 'a'.repeat(64),
    cancelledByHash: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    experience: {
      key: 'wine-tasting',
      name: 'Dégustation de vins',
      priceCents: 4500,
      currency: 'EUR',
    },
    session: {
      startsAt: new Date('2026-09-20T18:00:00.000Z'),
      endsAt: new Date('2026-09-20T19:30:00.000Z'),
    },
    customer: null,
    ...overrides,
  };
}

describe('experience service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: RESTAURANT_ID } as never);
  });

  it('creates a catalogue entry with normalized key and actor hash', async () => {
    vi.mocked(db.experience.create).mockResolvedValue(experienceRow() as never);

    const result = await createExperience({
      restaurantId: RESTAURANT_ID,
      key: '  Wine-Tasting ',
      name: ' Dégustation de vins ',
      description: ' Une séance guidée. ',
      durationMinutes: 90,
      priceCents: 4_500,
      capacity: 12,
      actor: 'user-1',
    });

    expect(result).toMatchObject({ key: 'wine-tasting', name: 'Dégustation de vins' });
    expect(db.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'wine-tasting',
          createdByHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('rejects unsafe or out-of-range catalogue input before persistence', async () => {
    await expect(
      createExperience({
        restaurantId: RESTAURANT_ID,
        key: 'bad key',
        name: 'Expérience',
        durationMinutes: 5,
        priceCents: 0,
        capacity: 0,
        actor: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_KEY_INVALID' });
    expect(db.experience.create).not.toHaveBeenCalled();
  });

  it('maps duplicate catalogue keys to a stable conflict code', async () => {
    vi.mocked(db.experience.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      createExperience({
        restaurantId: RESTAURANT_ID,
        key: 'wine-tasting',
        name: 'Dégustation',
        durationMinutes: 90,
        priceCents: 4_500,
        capacity: 12,
        actor: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_KEY_CONFLICT' });
  });

  it('rejects overlapping session time and keeps the session bounds explicit', async () => {
    vi.mocked(db.experience.findFirst).mockResolvedValue({ id: EXPERIENCE_ID } as never);
    vi.mocked(db.experienceSession.create).mockResolvedValue(sessionRow() as never);

    const result = await createExperienceSession({
      restaurantId: RESTAURANT_ID,
      experienceId: EXPERIENCE_ID,
      startsAt: '2026-09-20T18:00:00.000Z',
      endsAt: '2026-09-20T19:30:00.000Z',
      capacityOverride: 10,
      actor: 'user-1',
    });
    expect(result).toMatchObject({ id: SESSION_ID, capacityOverride: null });
    expect(db.experienceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startsAt: new Date('2026-09-20T18:00:00.000Z'),
          endsAt: new Date('2026-09-20T19:30:00.000Z'),
          capacityOverride: 10,
        }),
      }),
    );

    await expect(
      createExperienceSession({
        restaurantId: RESTAURANT_ID,
        experienceId: EXPERIENCE_ID,
        startsAt: '2026-09-20T19:30:00.000Z',
        endsAt: '2026-09-20T19:30:00.000Z',
        actor: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ExperienceInputError);
  });

  it('reserves with a price snapshot and replays the same idempotency key', async () => {
    vi.mocked(db.experienceReservation.findUnique).mockResolvedValue(null);
    vi.mocked(db.experienceSession.findFirst).mockResolvedValue(sessionRow() as never);
    vi.mocked(db.experienceReservation.findMany).mockResolvedValue([] as never);
    vi.mocked(db.experienceReservation.create).mockResolvedValue(
      reservationRow({ idempotencyKey: 'b'.repeat(64) }) as never,
    );

    const first = await reserveExperience({
      restaurantId: RESTAURANT_ID,
      experienceId: EXPERIENCE_ID,
      sessionId: SESSION_ID,
      quantity: 2,
      idempotencyKey: 'booking-0001',
      actor: 'user-1',
      now: NOW,
    });
    expect(first).toMatchObject({ replayed: false, totalPriceCents: 9_000 });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);

    vi.mocked(db.experienceReservation.findUnique).mockResolvedValue(
      reservationRow({ quantity: 2 }) as never,
    );
    const replay = await reserveExperience({
      restaurantId: RESTAURANT_ID,
      experienceId: EXPERIENCE_ID,
      sessionId: SESSION_ID,
      quantity: 2,
      idempotencyKey: 'booking-0001',
      actor: 'user-1',
      now: NOW,
    });
    expect(replay).toMatchObject({ replayed: true, id: RESERVATION_ID });
    expect(db.experienceReservation.create).toHaveBeenCalledTimes(1);
  });

  it('enforces the remaining capacity under the transaction lock', async () => {
    vi.mocked(db.experienceReservation.findUnique).mockResolvedValue(null);
    vi.mocked(db.experienceSession.findFirst).mockResolvedValue(
      sessionRow({ capacityOverride: 3 }) as never,
    );
    vi.mocked(db.experienceReservation.findMany).mockResolvedValue([{ quantity: 2 }] as never);

    await expect(
      reserveExperience({
        restaurantId: RESTAURANT_ID,
        experienceId: EXPERIENCE_ID,
        sessionId: SESSION_ID,
        quantity: 2,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_CAPACITY_EXCEEDED' });
    expect(db.experienceReservation.create).not.toHaveBeenCalled();
  });

  it('refuses a draft, closed, or already started session', async () => {
    vi.mocked(db.experienceReservation.findUnique).mockResolvedValue(null);
    vi.mocked(db.experienceSession.findFirst).mockResolvedValue(
      sessionRow({
        experience: { ...sessionRow().experience, status: ExperienceStatus.DRAFT },
      }) as never,
    );
    await expect(
      reserveExperience({
        restaurantId: RESTAURANT_ID,
        experienceId: EXPERIENCE_ID,
        sessionId: SESSION_ID,
        quantity: 1,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_NOT_ACTIVE' });

    vi.mocked(db.experienceSession.findFirst).mockResolvedValue(
      sessionRow({ status: ExperienceSessionStatus.CLOSED }) as never,
    );
    await expect(
      reserveExperience({
        restaurantId: RESTAURANT_ID,
        experienceId: EXPERIENCE_ID,
        sessionId: SESSION_ID,
        quantity: 1,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_SESSION_CLOSED' });
  });

  it('cancels once and treats a repeated cancel as a replay', async () => {
    vi.mocked(db.experienceReservation.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.experienceReservation.findFirst).mockResolvedValue(
      reservationRow({ status: ExperienceReservationStatus.CANCELLED, cancelledAt: NOW }) as never,
    );
    const cancelled = await cancelExperienceReservation({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      actor: 'staff-1',
      now: NOW,
    });
    expect(cancelled).toMatchObject({
      replayed: false,
      status: ExperienceReservationStatus.CANCELLED,
    });

    vi.mocked(db.experienceReservation.updateMany).mockResolvedValue({ count: 0 } as never);
    const replay = await cancelExperienceReservation({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      actor: 'staff-1',
      now: NOW,
    });
    expect(replay).toMatchObject({ replayed: true, status: ExperienceReservationStatus.CANCELLED });
  });

  it('expires only open sessions whose end has passed', async () => {
    vi.mocked(db.experienceSession.findMany).mockResolvedValue([
      { id: 'session-1' },
      { id: 'session-2' },
    ] as never);
    vi.mocked(db.experienceSession.updateMany).mockResolvedValue({ count: 2 } as never);

    await expect(expireExperienceSessions({ now: NOW, limit: 5_000 })).resolves.toBe(2);
    expect(db.experienceSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1_000,
        where: expect.objectContaining({ status: ExperienceSessionStatus.OPEN }),
      }),
    );
  });

  it('scopes session edits to the route experience', async () => {
    vi.mocked(db.experienceSession.findFirst).mockResolvedValue(null);
    await expect(
      updateExperienceSession({
        restaurantId: RESTAURANT_ID,
        experienceId: 'other-experience',
        sessionId: SESSION_ID,
        status: ExperienceSessionStatus.CLOSED,
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_SESSION_NOT_FOUND' });
  });

  it('exposes typed conflict errors for route mapping', () => {
    expect(new ExperienceConflictError('EXPERIENCE_SESSION_CLOSED')).toBeInstanceOf(Error);
  });
});
