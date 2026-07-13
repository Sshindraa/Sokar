import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuditLogService } from '../core/audit-log.service.js';
import { HoldService } from '../core/hold.service.js';
import {
  IdempotencyService,
  type IdempotencyStore,
  hashPayload,
} from '../core/idempotency.service.js';
import { buildPolicySnapshot } from '../core/policies.service.js';
import {
  ReservationService,
  ReservationSlotUnavailableError,
} from '../core/reservation.service.js';

type HoldRow = {
  id: string;
  restaurantId: string;
  type: 'QUOTE' | 'HOLD';
  partySize: number;
  slotStart: Date;
  slotEnd: Date;
  channel: string;
  holdToken: string | null;
  quoteToken: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'RELEASED';
  policyVersion: string;
  reservationId: string | null;
  createdAt: Date;
};

type ReservationRow = {
  id: string;
  restaurantId: string;
  partySize: number;
  reservedAt: Date;
  startsAt: Date | null;
  state:
    | 'PENDING'
    | 'CONFIRMED'
    | 'SEATED'
    | 'HONORED'
    | 'CANCELLED'
    | 'NO_SHOW'
    | 'FAILED'
    | 'EXPIRED';
  consumedHoldId: string | null;
};

function makeIdempotencyStore(): IdempotencyStore {
  const records = new Map<
    string,
    {
      payloadHash: string;
      reservationId: string | null;
      status: 'pending' | 'completed' | 'failed';
      expiresAt: Date;
    }
  >();

  return {
    async get(scope, key) {
      return records.get(`${scope}::${key}`) ?? null;
    },
    async insertPending({ scope, key, payloadHash, expiresAt }) {
      const recordKey = `${scope}::${key}`;
      if (records.has(recordKey)) {
        const err = new Error('unique violation') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      records.set(recordKey, { payloadHash, reservationId: null, status: 'pending', expiresAt });
    },
    async markCompleted({ scope, key, reservationId }) {
      const recordKey = `${scope}::${key}`;
      const existing = records.get(recordKey);
      if (!existing) throw new Error('not found');
      records.set(recordKey, { ...existing, reservationId, status: 'completed' });
    },
    async markFailed({ scope, key }) {
      const recordKey = `${scope}::${key}`;
      const existing = records.get(recordKey);
      if (!existing) return;
      records.set(recordKey, { ...existing, status: 'failed' });
    },
    async purgeExpired() {
      return 0;
    },
  };
}

function makeFakes() {
  const holds = new Map<string, HoldRow>();
  const reservations = new Map<string, ReservationRow>();
  const audits: Record<string, unknown>[] = [];

  const prisma = {
    $transaction: async (fn: unknown) =>
      (fn as unknown as (tx: PrismaClient) => Promise<unknown>)(prisma as unknown as PrismaClient),
    $queryRaw: async () => [{ id: 'locked' }],
    agenticHold: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const type = data.type as 'HOLD' | 'QUOTE';
        const status = (data.status as HoldRow['status'] | undefined) ?? 'ACTIVE';
        if (type === 'HOLD' && status === 'ACTIVE') {
          for (const hold of holds.values()) {
            const dSlotStart = data.slotStart;
            if (
              hold.restaurantId === data.restaurantId &&
              hold.partySize === data.partySize &&
              dSlotStart instanceof Date &&
              hold.slotStart.getTime() === dSlotStart.getTime() &&
              hold.type === 'HOLD' &&
              hold.status === 'ACTIVE'
            ) {
              const err = new Error('unique violation') as Error & { code: string };
              err.code = 'P2002';
              throw err;
            }
          }
        }

        const id = `hold-${holds.size + 1}`;
        const row: HoldRow = {
          id,
          restaurantId: data.restaurantId as string,
          type,
          partySize: data.partySize as number,
          slotStart: data.slotStart as Date,
          slotEnd: data.slotEnd as Date,
          channel: data.channel as string,
          holdToken: (data.holdToken as string | null | undefined) ?? null,
          quoteToken: (data.quoteToken as string | null | undefined) ?? null,
          expiresAt: data.expiresAt as Date,
          consumedAt: (data.consumedAt as Date | null | undefined) ?? null,
          status,
          policyVersion: data.policyVersion as string,
          reservationId: (data.reservationId as string | null | undefined) ?? null,
          createdAt: new Date(),
        };
        holds.set(id, row);
        return row;
      },
      findFirst: async () => null,
      findUnique: async ({ where }: { where: { id: string } }) => holds.get(where.id) ?? null,
      findMany: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        const out: unknown[] = [];
        for (const hold of holds.values()) {
          if (where.restaurantId !== undefined && hold.restaurantId !== where.restaurantId)
            continue;
          if (where.partySize !== undefined && hold.partySize !== where.partySize) continue;
          if (where.slotStart !== undefined) {
            const slotStart = where.slotStart;
            if (slotStart instanceof Date && hold.slotStart.getTime() !== slotStart.getTime())
              continue;
          }
          if (where.type !== undefined && hold.type !== where.type) continue;
          if (where.status !== undefined && hold.status !== where.status) continue;
          const expiresAt = where.expiresAt as Record<string, unknown> | undefined;
          const lt = expiresAt?.lt;
          if (lt instanceof Date && !(hold.expiresAt.getTime() < lt.getTime())) continue;
          out.push(
            select
              ? Object.fromEntries(
                  Object.keys(select).map((key) => [key, (hold as Record<string, unknown>)[key]]),
                )
              : hold,
          );
        }
        return out;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const hold = holds.get(where.id);
        if (!hold) throw new Error('not found');
        Object.assign(hold, data);
        return hold;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const hold of holds.values()) {
          const idFilter = where.id as string | Record<string, unknown> | undefined;
          const inArr =
            typeof idFilter === 'object' && idFilter !== null
              ? ((idFilter as Record<string, unknown>).in as unknown[] | undefined)
              : undefined;
          if (inArr && !inArr.includes(hold.id)) continue;
          if (typeof idFilter === 'string' && hold.id !== idFilter) continue;
          if (where.status !== undefined && hold.status !== where.status) continue;
          if (where.type !== undefined && hold.type !== where.type) continue;
          const expiresAt = where.expiresAt as Record<string, unknown> | undefined;
          const lt = expiresAt?.lt;
          if (lt instanceof Date && !(hold.expiresAt.getTime() < lt.getTime())) continue;
          const gt = expiresAt?.gt;
          if (gt instanceof Date && !(hold.expiresAt.getTime() > gt.getTime())) continue;
          Object.assign(hold, data);
          count++;
        }
        return { count };
      },
    },
    reservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `reservation-${reservations.size + 1}`;
        const row: ReservationRow = {
          id,
          restaurantId: data.restaurantId as string,
          partySize: data.partySize as number,
          reservedAt: data.reservedAt as Date,
          startsAt: (data.startsAt as Date | null | undefined) ?? null,
          state: data.state as ReservationRow['state'],
          consumedHoldId: (data.consumedHoldId as string | null | undefined) ?? null,
        };
        reservations.set(id, row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const OR = where.OR as Record<string, unknown>[] | undefined;
        const state = where.state as Record<string, unknown> | undefined;
        const stateIn = state?.in as unknown[] | undefined;
        for (const reservation of reservations.values()) {
          if (reservation.restaurantId !== where.restaurantId) continue;
          if (reservation.partySize !== where.partySize) continue;
          if (stateIn && !stateIn.includes(reservation.state)) continue;
          const or0 = OR?.[0];
          const or1 = OR?.[1];
          const or0ReservedAt = or0
            ? ((or0 as Record<string, unknown>).reservedAt as Date | null | undefined)
            : undefined;
          const sameReservedAt =
            or0ReservedAt instanceof Date &&
            reservation.reservedAt.getTime() === or0ReservedAt.getTime();
          const or1StartsAt = or1
            ? ((or1 as Record<string, unknown>).startsAt as Date | null | undefined)
            : undefined;
          const sameStartsAt =
            (or1StartsAt === null && reservation.startsAt === null) ||
            (or1StartsAt instanceof Date &&
              reservation.startsAt instanceof Date &&
              reservation.startsAt.getTime() === or1StartsAt.getTime());
          if (sameReservedAt || sameStartsAt) return { id: reservation.id };
        }
        return null;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        reservations.get(where.id) ?? null,
    },
    reservationAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;

  const audit = new AuditLogService(prisma);
  const holdService = new HoldService(prisma, audit);
  const idempotency = new IdempotencyService(makeIdempotencyStore());
  const reservationsService = new ReservationService(prisma, audit, holdService, idempotency);

  return { audits, holds, reservationsService };
}

const policy = buildPolicySnapshot({
  policyVersion: '2026-06-20',
  maxPartySize: 12,
  minLeadTimeMinutes: 0,
  requireManualValidation: false,
  quoteTtlSeconds: 300,
  holdTtlSeconds: 420,
  noShowPolicy: 'warning',
  notificationChannels: ['sms'],
  capacitySpecials: {},
});

describe('reservation.service', () => {
  it('crée une réservation avec hold synthétique consommé et audit', async () => {
    const fakes = makeFakes();
    const startsAt = new Date(Date.now() + 3_600_000);
    const payloadHash = hashPayload({ restaurantId: 'r-1', partySize: 4, startsAt });

    const result = await fakes.reservationsService.createReservation(
      {
        restaurantId: 'r-1',
        partySize: 4,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 90 * 60_000),
        customerName: 'Jean Test',
        customerPhone: '+33600000000',
        channel: 'MCP',
        policy,
        actor: 'agent:test',
      },
      {
        scope: 'scope-1',
        key: 'key-1',
        payloadHash,
        ttlSeconds: 300,
      },
    );

    expect(result.reused).toBe(false);
    expect(result.state).toBe('CONFIRMED');
    expect([...fakes.holds.values()][0].status).toBe('CONSUMED');
    expect(fakes.audits.map((audit) => audit.event)).toContain('hold_consumed');
    expect(fakes.audits.map((audit) => audit.event)).toContain('reservation_created');
  });

  it('rejette une deuxième réservation sur le même slot', async () => {
    const fakes = makeFakes();
    const startsAt = new Date(Date.now() + 3_600_000);
    const baseInput = {
      restaurantId: 'r-1',
      partySize: 4,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 90 * 60_000),
      customerName: 'Jean Test',
      customerPhone: '+33600000000',
      channel: 'MCP' as const,
      policy,
      actor: 'agent:test',
    };

    await fakes.reservationsService.createReservation(baseInput, {
      scope: 'scope-1',
      key: 'key-1',
      payloadHash: hashPayload({ key: 1, startsAt }),
      ttlSeconds: 300,
    });

    await expect(
      fakes.reservationsService.createReservation(
        { ...baseInput, customerName: 'Marie Test' },
        {
          scope: 'scope-2',
          key: 'key-2',
          payloadHash: hashPayload({ key: 2, startsAt }),
          ttlSeconds: 300,
        },
      ),
    ).rejects.toThrow(ReservationSlotUnavailableError);
  });

  it('expire un hold actif dépassé avant de créer une réservation directe', async () => {
    const fakes = makeFakes();
    const startsAt = new Date(Date.now() + 3_600_000);
    fakes.holds.set('expired-hold', {
      id: 'expired-hold',
      restaurantId: 'r-1',
      type: 'HOLD',
      partySize: 4,
      slotStart: startsAt,
      slotEnd: new Date(startsAt.getTime() + 90 * 60_000),
      channel: 'MCP',
      holdToken: 'expired-token',
      quoteToken: null,
      expiresAt: new Date(Date.now() - 1_000),
      consumedAt: null,
      status: 'ACTIVE',
      policyVersion: policy.policyVersion,
      reservationId: null,
      createdAt: new Date(Date.now() - 10_000),
    });

    const result = await fakes.reservationsService.createReservation(
      {
        restaurantId: 'r-1',
        partySize: 4,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 90 * 60_000),
        customerName: 'Jean Test',
        customerPhone: '+33600000000',
        channel: 'MCP',
        policy,
        actor: 'agent:test',
      },
      {
        scope: 'scope-expired',
        key: 'key-expired',
        payloadHash: hashPayload({ restaurantId: 'r-1', startsAt }),
        ttlSeconds: 300,
      },
    );

    expect(result.state).toBe('CONFIRMED');
    expect(fakes.holds.get('expired-hold')?.status).toBe('EXPIRED');
    expect(fakes.audits.map((audit) => audit.event)).toContain('hold_expired');
    expect([...fakes.holds.values()].filter((hold) => hold.status === 'CONSUMED')).toHaveLength(1);
  });
});
