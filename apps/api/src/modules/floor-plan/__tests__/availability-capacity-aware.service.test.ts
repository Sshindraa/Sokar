import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PrismaClient,
  Restaurant,
  RestaurantExposureSettings,
  Table,
  Reservation,
  AgenticHold,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CapacityAwareAvailabilityService } from '../availability-capacity-aware.service.js';

vi.mock('../../../shared/redis/client', () => {
  const store = new Map<string, string>();
  const reset = () => store.clear();

  const redisCache = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const val = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(val));
      return val;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    __resetStore: reset,
  };

  return {
    redisCache,
    redisSession: {},
    redisQueue: { on: vi.fn() },
    getCachedContext: vi.fn(),
    setCachedContext: vi.fn(),
  };
});

import { redisCache } from '../../../shared/redis/client';

type MinimalRestaurant = Restaurant & { exposureSettings: RestaurantExposureSettings | null };

function makeRestaurant(
  overrides: Partial<MinimalRestaurant> & { id: string; openingHours: unknown },
): MinimalRestaurant {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Resto',
    plan: overrides.plan ?? 'STARTER',
    managerPhone: overrides.managerPhone ?? '+33100000000',
    managerEmail: overrides.managerEmail ?? 'manager@example.com',
    phoneNumber: overrides.phoneNumber ?? '+33100000000',
    openingHours: overrides.openingHours as Prisma.JsonValue,
    carrier: overrides.carrier ?? 'vapi',
    smsConfirmEnabled: overrides.smsConfirmEnabled ?? true,
    theforkSavings: (overrides.theforkSavings ?? 0) as unknown as Prisma.Decimal,
    googleCalendarId: overrides.googleCalendarId ?? null,
    googleRefreshToken: overrides.googleRefreshToken ?? null,
    onboardingTasks: overrides.onboardingTasks ?? {},
    onboardingDone: overrides.onboardingDone ?? false,
    onboardingCompletedAt: overrides.onboardingCompletedAt ?? null,
    onboardingActivatedAt: overrides.onboardingActivatedAt ?? null,
    onboardingLastSeenAt: overrides.onboardingLastSeenAt ?? null,
    firstCallAt: overrides.firstCallAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    slug: overrides.slug ?? null,
    canonicalUrl: overrides.canonicalUrl ?? null,
    websiteUrl: overrides.websiteUrl ?? null,
    platformUrl: overrides.platformUrl ?? null,
    lat: overrides.lat ?? null,
    lng: overrides.lng ?? null,
    formattedAddress: overrides.formattedAddress ?? null,
    timezone: overrides.timezone ?? 'Europe/Paris',
    phoneE164: overrides.phoneE164 ?? null,
    cuisineType: overrides.cuisineType ?? [],
    priceRange: overrides.priceRange ?? null,
    ambiance: overrides.ambiance ?? [],
    noiseLevel: overrides.noiseLevel ?? null,
    dietary: overrides.dietary ?? [],
    attributeConfidence: overrides.attributeConfidence ?? {},
    agenticOptIn: overrides.agenticOptIn ?? false,
    openaiReserveEnabled: overrides.openaiReserveEnabled ?? false,
    policyVersion: overrides.policyVersion ?? '2026-06-20',
    description: overrides.description ?? null,
    city: overrides.city ?? null,
    country: overrides.country ?? 'FR',
    postalCode: overrides.postalCode ?? null,
    coverImageUrl: overrides.coverImageUrl ?? null,
    publishedAt: overrides.publishedAt ?? null,
    googlePlaceId: overrides.googlePlaceId ?? null,
    googleRating: overrides.googleRating ?? null,
    googleReviewCount: overrides.googleReviewCount ?? null,
    googleRatingSyncedAt: overrides.googleRatingSyncedAt ?? null,
    giftCardMinimumAmount: overrides.giftCardMinimumAmount ?? null,
    giftCardCommissionRate: (overrides.giftCardCommissionRate ?? 0.05) as unknown as Prisma.Decimal,
    exposureSettings: overrides.exposureSettings ?? null,
  };
}

function makeExposureSettings(
  overrides: Partial<RestaurantExposureSettings> & { restaurantId: string },
): RestaurantExposureSettings {
  return {
    restaurantId: overrides.restaurantId,
    mcpEnabled: overrides.mcpEnabled ?? false,
    openaiReserveEnabled: overrides.openaiReserveEnabled ?? false,
    exposedCreneaux: overrides.exposedCreneaux ?? [],
    maxPartySize: overrides.maxPartySize ?? 12,
    minLeadTimeMinutes: overrides.minLeadTimeMinutes ?? 30,
    requireManualValidation: overrides.requireManualValidation ?? false,
    quoteTtlSeconds: overrides.quoteTtlSeconds ?? 300,
    holdTtlSeconds: overrides.holdTtlSeconds ?? 420,
    noShowPolicy: overrides.noShowPolicy ?? 'warning',
    notificationChannels: overrides.notificationChannels ?? ['sms', 'email'],
    capacitySpecials: overrides.capacitySpecials ?? {},
    connectPublished: overrides.connectPublished ?? false,
    connectAgentic: overrides.connectAgentic ?? false,
    connectPublishedAt: overrides.connectPublishedAt ?? null,
    connectDescription: overrides.connectDescription ?? null,
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

function makeTable(
  overrides: Partial<Table> & { id: string; capacity: number; floorPlanId: string },
): Table {
  return {
    id: overrides.id,
    floorPlanId: overrides.floorPlanId,
    sectionId: overrides.sectionId ?? null,
    name: overrides.name ?? `Table ${overrides.id}`,
    capacity: overrides.capacity,
    minCapacity: overrides.minCapacity ?? 1,
    positionX: overrides.positionX ?? null,
    positionY: overrides.positionY ?? null,
    width: overrides.width ?? null,
    height: overrides.height ?? null,
    rotation: overrides.rotation ?? 0,
    shape: overrides.shape ?? 'rect',
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

function makeReservation(
  overrides: Partial<Reservation> & { id: string; tableId: string; startsAt: Date; endsAt: Date },
): Reservation {
  return {
    id: overrides.id,
    restaurantId: overrides.restaurantId ?? 'r-1',
    callId: overrides.callId ?? null,
    customerId: overrides.customerId ?? null,
    reservedAt: overrides.reservedAt ?? overrides.startsAt,
    partySize: overrides.partySize ?? 2,
    customerName: overrides.customerName ?? 'Client',
    customerPhone: overrides.customerPhone ?? null,
    status: overrides.status ?? 'CONFIRMED',
    estimatedRevenue: overrides.estimatedRevenue ?? null,
    confirmedRevenue: overrides.confirmedRevenue ?? null,
    googleEventId: overrides.googleEventId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    channel: overrides.channel ?? 'PHONE',
    state: overrides.state ?? 'CONFIRMED',
    startsAt: overrides.startsAt,
    endsAt: overrides.endsAt,
    specialRequests: overrides.specialRequests ?? null,
    createdByClient: overrides.createdByClient ?? null,
    cancellationPolicySnap: overrides.cancellationPolicySnap ?? null,
    noShowPolicySnap: overrides.noShowPolicySnap ?? null,
    consents: overrides.consents ?? {},
    privacyPolicyVersion: overrides.privacyPolicyVersion ?? '2026-06-20',
    idempotencyScope: overrides.idempotencyScope ?? null,
    idempotencyKey: overrides.idempotencyKey ?? null,
    idempotencyPayloadHash: overrides.idempotencyPayloadHash ?? null,
    consumedHoldId: overrides.consumedHoldId ?? null,
    source: overrides.source ?? null,
    confirmationStatus: overrides.confirmationStatus ?? 'NOT_REQUIRED',
    confirmationSentAt: overrides.confirmationSentAt ?? null,
    confirmedAt: overrides.confirmedAt ?? null,
    tableId: overrides.tableId,
    giftCardRedemptionSnap: null,
    giftCardComplementAmount: null,
  };
}

function makeHold(
  overrides: Partial<AgenticHold> & { id: string; tableId: string; slotStart: Date; slotEnd: Date },
): AgenticHold {
  return {
    id: overrides.id,
    restaurantId: overrides.restaurantId ?? 'r-1',
    type: overrides.type ?? 'HOLD',
    partySize: overrides.partySize ?? 2,
    slotStart: overrides.slotStart,
    slotEnd: overrides.slotEnd,
    channel: overrides.channel ?? 'WEB',
    quoteToken: overrides.quoteToken ?? null,
    holdToken: overrides.holdToken ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 60 * 1000),
    consumedAt: overrides.consumedAt ?? null,
    status: overrides.status ?? 'ACTIVE',
    policyVersion: overrides.policyVersion ?? '2026-06-20',
    reservationId: overrides.reservationId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    tableId: overrides.tableId,
  };
}

function makeMockPrisma(initial: {
  restaurant?: MinimalRestaurant;
  tables?: Table[];
  reservations?: Reservation[];
  holds?: AgenticHold[];
}) {
  const restaurant = initial.restaurant;
  const tables = initial.tables ?? [];
  const reservations = initial.reservations ?? [];
  const holds = initial.holds ?? [];
  const floorPlanId = tables[0]?.floorPlanId ?? 'fp-1';

  const prisma = {
    restaurant: {
      findUnique: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const id = where.id as string | undefined;
        if (id === restaurant?.id) {
          return restaurant ?? null;
        }
        return null;
      },
    },
    floorPlan: {
      findUnique: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const restaurantId = where.restaurantId as string | undefined;
        if (restaurantId === restaurant?.id) {
          return { id: floorPlanId };
        }
        return null;
      },
    },
    table: {
      findMany: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const floorPlanId = where.floorPlanId as string | undefined;
        const isActive = where.isActive as boolean | undefined;
        const capacity = where.capacity as { gte?: number } | undefined;
        return tables.filter((t) => {
          if (floorPlanId && t.floorPlanId !== floorPlanId) return false;
          if (isActive === true && !t.isActive) return false;
          if (capacity?.gte && t.capacity < capacity.gte) return false;
          return true;
        });
      },
    },
    reservation: {
      findMany: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const restaurantId = where.restaurantId as string | undefined;
        const state = where.state as { in?: string[] } | undefined;
        const tableId = where.tableId as { not?: string | null } | undefined;
        const startsAt = where.startsAt as { gte?: Date; lt?: Date } | undefined;
        return reservations.filter((r) => {
          if (restaurantId && r.restaurantId !== restaurantId) return false;
          if (state?.in && !state.in.includes(r.state)) return false;
          const tableIdNot = tableId?.not;
          if (tableIdNot === null && r.tableId === null) return false;
          if (tableIdNot != null && r.tableId !== tableIdNot) return false;
          if (startsAt?.gte && r.startsAt! < startsAt.gte) return false;
          if (startsAt?.lt && r.startsAt! >= startsAt.lt) return false;
          return true;
        });
      },
    },
    agenticHold: {
      findMany: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const restaurantId = where.restaurantId as string | undefined;
        const status = where.status as string | undefined;
        const expiresAt = where.expiresAt as { gt?: Date } | undefined;
        const tableId = where.tableId as { not?: string | null } | undefined;
        const slotStart = where.slotStart as { gte?: Date; lt?: Date } | undefined;
        return holds.filter((h) => {
          if (restaurantId && h.restaurantId !== restaurantId) return false;
          if (status && h.status !== status) return false;
          if (expiresAt?.gt && !(h.expiresAt > expiresAt.gt)) return false;
          const tableIdNot = tableId?.not;
          if (tableIdNot === null && h.tableId === null) return false;
          if (tableIdNot != null && h.tableId !== tableIdNot) return false;
          if (slotStart?.gte && h.slotStart < slotStart.gte) return false;
          if (slotStart?.lt && h.slotStart >= slotStart.lt) return false;
          return true;
        });
      },
    },
  } as unknown as PrismaClient;

  return { prisma };
}

const RESTAURANT_ID = 'r-1';
const FLOOR_PLAN_ID = 'fp-1';
const date = '2026-07-02';
const openingHours = {
  monday: { open: '12:00', close: '14:30' },
  tuesday: { open: '12:00', close: '14:30' },
  wednesday: { open: '12:00', close: '14:30' },
  thursday: { open: '12:00', close: '22:30' },
  friday: { open: '12:00', close: '14:30' },
  saturday: { open: '19:00', close: '22:30' },
  sunday: { open: '19:00', close: '22:30' },
};

function makeBaseRestaurant(capacitySpecials: unknown = {}) {
  return makeRestaurant({
    id: RESTAURANT_ID,
    timezone: 'Europe/Paris',
    openingHours,
    exposureSettings: makeExposureSettings({
      restaurantId: RESTAURANT_ID,
      capacitySpecials: capacitySpecials as Prisma.JsonValue,
    }),
  });
}

describe('CapacityAwareAvailabilityService', () => {
  beforeEach(() => {
    (redisCache as unknown as { __resetStore: () => void }).__resetStore();
    vi.clearAllMocks();
  });

  it('retourne le contrat AvailabilityDto attendu', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    expect(dto.restaurantId).toBe(RESTAURANT_ID);
    expect(dto.date).toBe(date);
    expect(dto.partySize).toBe(2);
    expect(dto.slots.length).toBeGreaterThan(0);
    expect(dto.slots[0]).toHaveProperty('time');
    expect(dto.slots[0]).toHaveProperty('available');
  });

  it('créneau disponible si au moins une table libre', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    const slot20 = dto.slots.find((s) => s.time === '20:00');
    expect(slot20).toBeDefined();
    expect(slot20!.available).toBe(true);
  });

  it('créneau indisponible si toutes les tables occupées', async () => {
    const startsAt = new Date('2026-07-02T17:00:00Z');
    const endsAt = new Date('2026-07-02T19:00:00Z');
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
      reservations: [makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    const slot20 = dto.slots.find((s) => s.time === '20:00');
    expect(slot20!.available).toBe(false);
  });

  it('partySize supérieur à la plus grande table → indisponible', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 6 });

    expect(dto.slots.every((s) => !s.available)).toBe(true);
  });

  it('serviceDurationMinutes lu depuis capacitySpecials', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant({ serviceDurationMinutes: 90 }),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    expect(dto.slots.length).toBeGreaterThan(0);
    // 12:00 à 22:30 → 90min slots = 12:00, 13:30, 15:00, 16:30, 18:00, 19:30, 21:00
    expect(dto.slots.some((s) => s.time === '18:00')).toBe(true);
    expect(dto.slots.some((s) => s.time === '19:30')).toBe(true);
  });

  it('fallback 120 min si serviceDuration non configuré', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    // 12:00 à 22:30 → 120min slots = 12:00, 14:00, 16:00, 18:00, 20:00, 22:00
    expect(dto.slots.some((s) => s.time === '18:00')).toBe(true);
    expect(dto.slots.some((s) => s.time === '20:00')).toBe(true);
  });

  it('timezone respectée : jour correct pour la date', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    // 2026-07-02 est un jeudi, donc service du midi en Europe/Paris
    expect(dto.slots.some((s) => s.time === '12:00')).toBe(true);
  });

  it('retourne [] si le restaurant est introuvable', async () => {
    const { prisma } = makeMockPrisma({});

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({ restaurantId: 'inconnu', date, partySize: 2 });

    expect(dto.slots).toEqual([]);
  });

  it('met en cache Redis avec TTL', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    await service.getAvailability({ restaurantId: RESTAURANT_ID, date, partySize: 2 });

    expect(redisCache.set).toHaveBeenCalledWith(
      expect.stringContaining('availability:v:r-1'),
      expect.any(String),
      'EX',
      30,
    );
  });

  it('retourne le résultat en cache au second appel', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const first = await service.getAvailability({
      restaurantId: RESTAURANT_ID,
      date,
      partySize: 2,
    });
    const second = await service.getAvailability({
      restaurantId: RESTAURANT_ID,
      date,
      partySize: 2,
    });

    expect(second).toEqual(first);
    expect(redisCache.set).toHaveBeenCalledTimes(1);
  });

  it('invalide le cache sur mutation', async () => {
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [makeTable({ id: 't-1', floorPlanId: FLOOR_PLAN_ID, capacity: 4 })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const first = await service.getAvailability({
      restaurantId: RESTAURANT_ID,
      date,
      partySize: 2,
    });

    await CapacityAwareAvailabilityService.invalidateAvailability(RESTAURANT_ID);

    const second = await service.getAvailability({
      restaurantId: RESTAURANT_ID,
      date,
      partySize: 2,
    });

    expect(second).toEqual(first);
    expect(redisCache.incr).toHaveBeenCalledWith(expect.stringContaining('availability:v:r-1'));
    expect(redisCache.set).toHaveBeenCalledTimes(2);
  });

  it('honore la section préférée quand une table de cette section est libre', async () => {
    const sectionId = 'section-terrasse';
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [
        makeTable({ id: 't-inside', floorPlanId: FLOOR_PLAN_ID, capacity: 4 }),
        makeTable({ id: 't-terrasse', floorPlanId: FLOOR_PLAN_ID, capacity: 4, sectionId }),
      ],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({
      restaurantId: RESTAURANT_ID,
      date,
      partySize: 2,
      preferredSectionId: sectionId,
    });

    const slot20 = dto.slots.find((s) => s.time === '20:00');
    expect(slot20!.available).toBe(true);
  });

  it('retombe sur les autres tables si la section préférée est pleine', async () => {
    const sectionId = 'section-terrasse';
    const startsAt = new Date('2026-07-02T17:00:00Z');
    const endsAt = new Date('2026-07-02T19:00:00Z');
    const { prisma } = makeMockPrisma({
      restaurant: makeBaseRestaurant(),
      tables: [
        makeTable({ id: 't-inside', floorPlanId: FLOOR_PLAN_ID, capacity: 4 }),
        makeTable({ id: 't-terrasse', floorPlanId: FLOOR_PLAN_ID, capacity: 4, sectionId }),
      ],
      reservations: [makeReservation({ id: 'r-1', tableId: 't-terrasse', startsAt, endsAt })],
    });

    const service = new CapacityAwareAvailabilityService(prisma);
    const dto = await service.getAvailability({
      restaurantId: RESTAURANT_ID,
      date,
      partySize: 2,
      preferredSectionId: sectionId,
    });

    const slot20 = dto.slots.find((s) => s.time === '20:00');
    expect(slot20!.available).toBe(true);
  });
});
