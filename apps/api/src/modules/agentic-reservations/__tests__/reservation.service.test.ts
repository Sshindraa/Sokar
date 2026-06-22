import { describe, expect, it } from 'vitest';
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
  const audits: any[] = [];

  const prisma: any = {
    $transaction: async (fn: any) => fn(prisma),
    agenticHold: {
      create: async ({ data }: any) => {
        if (data.type === 'HOLD' && data.status === 'ACTIVE') {
          for (const hold of holds.values()) {
            if (
              hold.restaurantId === data.restaurantId &&
              hold.partySize === data.partySize &&
              hold.slotStart.getTime() === data.slotStart.getTime() &&
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
          restaurantId: data.restaurantId,
          type: data.type,
          partySize: data.partySize,
          slotStart: data.slotStart,
          slotEnd: data.slotEnd,
          channel: data.channel,
          holdToken: data.holdToken ?? null,
          quoteToken: data.quoteToken ?? null,
          expiresAt: data.expiresAt,
          consumedAt: data.consumedAt ?? null,
          status: data.status ?? 'ACTIVE',
          policyVersion: data.policyVersion,
          reservationId: data.reservationId ?? null,
          createdAt: new Date(),
        };
        holds.set(id, row);
        return row;
      },
      findFirst: async () => null,
      findUnique: async ({ where }: any) => holds.get(where.id) ?? null,
      findMany: async ({ where, select }: any) => {
        const out: any[] = [];
        for (const hold of holds.values()) {
          if (where.restaurantId && hold.restaurantId !== where.restaurantId) continue;
          if (where.partySize && hold.partySize !== where.partySize) continue;
          if (where.slotStart && hold.slotStart.getTime() !== where.slotStart.getTime()) continue;
          if (where.type && hold.type !== where.type) continue;
          if (where.status && hold.status !== where.status) continue;
          if (where.expiresAt?.lt && !(hold.expiresAt.getTime() < where.expiresAt.lt.getTime()))
            continue;
          out.push(
            select
              ? Object.fromEntries(Object.keys(select).map((key) => [key, (hold as any)[key]]))
              : hold,
          );
        }
        return out;
      },
      update: async ({ where, data }: any) => {
        const hold = holds.get(where.id);
        if (!hold) throw new Error('not found');
        Object.assign(hold, data);
        return hold;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const hold of holds.values()) {
          if (typeof where.id === 'string' && hold.id !== where.id) continue;
          if (where.status && hold.status !== where.status) continue;
          if (where.type && hold.type !== where.type) continue;
          if (where.expiresAt?.lt && !(hold.expiresAt.getTime() < where.expiresAt.lt.getTime()))
            continue;
          if (where.expiresAt?.gt && !(hold.expiresAt.getTime() > where.expiresAt.gt.getTime()))
            continue;
          Object.assign(hold, data);
          count++;
        }
        return { count };
      },
    },
    reservation: {
      create: async ({ data }: any) => {
        const id = `reservation-${reservations.size + 1}`;
        const row: ReservationRow = {
          id,
          restaurantId: data.restaurantId,
          partySize: data.partySize,
          reservedAt: data.reservedAt,
          startsAt: data.startsAt ?? null,
          state: data.state,
          consumedHoldId: data.consumedHoldId ?? null,
        };
        reservations.set(id, row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        for (const reservation of reservations.values()) {
          if (reservation.restaurantId !== where.restaurantId) continue;
          if (reservation.partySize !== where.partySize) continue;
          if (!where.state.in.includes(reservation.state)) continue;
          const sameReservedAt =
            reservation.reservedAt.getTime() === where.OR[0].reservedAt.getTime();
          const sameStartsAt = reservation.startsAt?.getTime() === where.OR[1].startsAt.getTime();
          if (sameReservedAt || sameStartsAt) return { id: reservation.id };
        }
        return null;
      },
      findUnique: async ({ where }: any) => reservations.get(where.id) ?? null,
    },
    reservationAuditLog: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
  };

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
