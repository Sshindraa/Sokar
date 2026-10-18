/**
 * PostgreSQL-only proof : un client placé sans réservation bloque sa table dans le moteur de
 * disponibilités partagé (téléphone, en ligne, MCP), pendant la durée de repas du restaurant, et la
 * libère dès que la table est libérée.
 *
 * La suite est ignorée pendant le run unitaire normal et rejoint le profil `AGENTIC_INT_TESTS=1`.
 * Elle exige les migrations et une base jetable. Le cache Redis est remplacé par une mémoire : la
 * mise en cache de 30 s des disponibilités reste donc exercée, et l'invalidation avec elle.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@prisma/client');

vi.mock('../../../shared/redis/client', () => {
  const store = new Map<string, string>();
  const redisCache = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    __clear: () => store.clear(),
  };
  return {
    redisCache,
    redisSession: {},
    redisQueue: { on: vi.fn() },
    getCachedContext: vi.fn(),
    setCachedContext: vi.fn(),
  };
});

import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { redisCache } from '../../../shared/redis/client';
import { CapacityAwareAvailabilityService } from '../availability-capacity-aware.service';
import { FloorPlanService } from '../floor-plan.service';
import { AuditLogService } from '../../agentic-reservations/core/audit-log.service';
import { HoldService } from '../../agentic-reservations/core/hold.service';
import { IdempotencyService } from '../../agentic-reservations/core/idempotency.service';
import { PrismaIdempotencyStore } from '../../agentic-reservations/core/prisma-store';
import { ReservationService } from '../../agentic-reservations/core/reservation.service';

const runIntegration = process.env.AGENTIC_INT_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

// Mardi 10 mars 2099, 13:00 à Paris (UTC+1). Le restaurant est ouvert tous les jours de 12:00 à 23:00.
const DATE = '2099-03-10';
const NOW = new Date('2099-03-10T12:00:00.000Z');
const SERVICE = { open: '12:00', close: '23:00' };
const OPENING_HOURS = {
  sun: SERVICE,
  mon: SERVICE,
  tue: SERVICE,
  wed: SERVICE,
  thu: SERVICE,
  fri: SERVICE,
  sat: SERVICE,
};

describeIntegration('client sans réservation : disponibilités — PostgreSQL', () => {
  const prisma = new PrismaClient();
  const floorPlans = new FloorPlanService(prisma);
  const availability = new CapacityAwareAvailabilityService(prisma);
  const audit = new AuditLogService(prisma);
  const reservations = new ReservationService(
    prisma,
    audit,
    new HoldService(prisma, audit),
    new IdempotencyService(new PrismaIdempotencyStore(prisma)),
  );

  let restaurantId: string;
  let tableId: string;

  /** Un restaurant d'une seule table de 4 : la disponibilité dépend donc de cette seule table. */
  async function createRestaurant(capacitySpecials: Prisma.InputJsonObject) {
    const id = `walk-in-${randomUUID()}`;
    await prisma.restaurant.create({
      data: {
        id,
        name: 'Chez Sans Réservation',
        slug: id,
        managerPhone: '+33600000000',
        managerEmail: 'walk-in@example.com',
        phoneNumber: `+331${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        timezone: 'Europe/Paris',
        openingHours: OPENING_HOURS,
        exposureSettings: { create: { capacitySpecials } },
        floorPlans: {
          create: {
            isDefault: true,
            isActive: true,
            tables: { create: { name: 'T4', capacity: 4, minCapacity: 1 } },
          },
        },
      },
    });
    const table = await prisma.table.findFirstOrThrow({
      where: { floorPlan: { restaurantId: id } },
    });
    restaurantId = id;
    tableId = table.id;
  }

  const slotIsAvailable = async (time: string, partySize = 2) => {
    const dto = await availability.getAvailability({ restaurantId, date: DATE, partySize });
    const slot = dto.slots.find((candidate) => candidate.time === time);
    expect(slot, `créneau ${time} absent de la disponibilité`).toBeDefined();
    return slot!.available;
  };

  const placeClient = () =>
    floorPlans.createWalkIn({
      restaurantId,
      tableId,
      partySize: 2,
      idempotencyKey: randomUUID(),
    });

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  beforeEach(() => {
    (redisCache as unknown as { __clear: () => void }).__clear();
  });

  // Pas de nettoyage des lignes : `reservation_audit_log` est en ajout seulement (déclencheur SQL) et
  // bloque aussi les suppressions en cascade. Chaque test crée son propre restaurant dans la base
  // jetable, donc rien n'est partagé d'un test à l'autre.
  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$disconnect();
  });

  it('bloque la table sur la durée de repas (2 h par défaut), puis la rend disponible après', async () => {
    await createRestaurant({});
    // Avant : la disponibilité est lue, donc mise en cache. Si la création ne l'invalidait pas, la
    // table resterait proposée au téléphone et en ligne pendant 30 s.
    expect(await slotIsAvailable('14:00')).toBe(true);

    const placed = await placeClient();

    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: placed.id } });
    expect(row.state).toBe('SEATED');
    expect((row.endsAt!.getTime() - row.startsAt!.getTime()) / 60_000).toBe(120);
    // Placé à 13:00 pour 2 h : la table est prise jusqu'à 15:00. Les créneaux de 13:00 et avant sont
    // déjà passés (indisponibles pour une autre raison) : on ne regarde que ceux à venir.
    expect(await slotIsAvailable('13:30')).toBe(false);
    expect(await slotIsAvailable('14:00')).toBe(false);
    expect(await slotIsAvailable('15:00')).toBe(true);
    expect(await slotIsAvailable('18:00')).toBe(true);
  });

  it('suit la durée de repas réglée à 150 min : la table est encore bloquée à +2 h 15', async () => {
    await createRestaurant({ serviceDurationMinutes: 150 });

    const placed = await placeClient();

    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: placed.id } });
    expect((row.endsAt!.getTime() - row.startsAt!.getTime()) / 60_000).toBe(150);
    // 13:00 + 2 h 15 = 15:15, le créneau de 15:00 chevauche encore le repas (jusqu'à 15:30).
    expect(await slotIsAvailable('15:00')).toBe(false);
    expect(await slotIsAvailable('15:30')).toBe(true);
  });

  it('libère la table tout de suite avec « Libérer la table » (HONORED)', async () => {
    await createRestaurant({});
    const placed = await placeClient();
    expect(await slotIsAvailable('14:00')).toBe(false);

    await reservations.transitionState({
      reservationId: placed.id,
      restaurantId,
      toState: 'HONORED',
      actor: restaurantId,
    });

    expect(await slotIsAvailable('14:00')).toBe(true);
    expect(await slotIsAvailable('13:30')).toBe(true);
  });

  it('refuse un second client sur une table déjà occupée', async () => {
    await createRestaurant({});
    await placeClient();
    await expect(placeClient()).rejects.toMatchObject({ code: 'TABLE_NOT_AVAILABLE' });
  });
});
