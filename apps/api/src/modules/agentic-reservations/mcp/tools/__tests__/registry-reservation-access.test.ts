import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { McpToolRegistry, executeTool, type ToolContext } from '../registry';
import type { McpRateLimiter } from '../../rate-limit';

const RESERVATION_ID = '550e8400-e29b-41d4-a716-446655440000';
const RESTAURANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const PHONE = '+33612345678';
const ctx: ToolContext = {
  clientId: 'client-a',
  clientName: 'Agent A',
  restaurantId: null,
  scopes: ['mcp:read', 'mcp:cancel'],
  actor: 'agent:client-a',
  transport: 'mcp',
};

function makeRegistry(createdByClient = ctx.actor, state = 'CONFIRMED') {
  const prisma = {
    reservation: {
      findUnique: vi.fn().mockResolvedValue({
        id: RESERVATION_ID,
        restaurantId: RESTAURANT_ID,
        createdByClient,
        customerPhone: PHONE,
        state,
        partySize: 2,
        startsAt: new Date('2026-12-01T19:00:00Z'),
        endsAt: new Date('2026-12-01T21:00:00Z'),
        createdAt: new Date('2026-09-28T19:00:00Z'),
      }),
    },
    restaurant: {
      findFirst: vi.fn().mockResolvedValue({
        timezone: 'Europe/Paris',
        exposureSettings: {
          maxPartySize: 7,
          minLeadTimeMinutes: 0,
          exposedCreneaux: [],
        },
        floorPlans: [],
      }),
    },
  } as unknown as PrismaClient;
  const limiter = {
    check: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as McpRateLimiter;
  return new McpToolRegistry(prisma, limiter);
}

describe('public MCP reservation access', () => {
  it('hides status and cancel from another OAuth client', async () => {
    const registry = makeRegistry('agent:client-b');
    const input = { reservationId: RESERVATION_ID, customerPhone: PHONE };
    expect(await registry.getReservationStatus(input, ctx)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await registry.cancelReservation(input, ctx)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('requires the customer phone even for the creating client', async () => {
    const registry = makeRegistry();
    const input = { reservationId: RESERVATION_ID };
    expect(await registry.getReservationStatus(input, ctx)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await registry.cancelReservation({ ...input, customerPhone: '+33600000000' }, ctx),
    ).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('returns status to the creating client with the matching phone', async () => {
    const registry = makeRegistry();
    const result = await registry.getReservationStatus(
      { reservationId: RESERVATION_ID, customerPhone: PHONE },
      ctx,
    );
    expect(result).toMatchObject({ ok: true, data: { id: RESERVATION_ID, state: 'CONFIRMED' } });
    if (result.ok) expect(result.data).not.toHaveProperty('customerPhone');
  });

  it('returns success when a reservation was already cancelled', async () => {
    const registry = makeRegistry(ctx.actor, 'CANCELLED');
    const reservationService = (
      registry as unknown as {
        reservationService: { cancelReservation: (args: unknown) => Promise<void> };
      }
    ).reservationService;
    const cancel = vi.spyOn(reservationService, 'cancelReservation');

    const result = await registry.cancelReservation(
      { reservationId: RESERVATION_ID, customerPhone: PHONE },
      ctx,
    );

    expect(result).toEqual({ ok: true, data: { cancelled: true } });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('treats a concurrent successful cancellation as an idempotent success', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        restaurantId: RESTAURANT_ID,
        createdByClient: ctx.actor,
        customerPhone: PHONE,
        state: 'CONFIRMED',
      })
      .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID, state: 'CANCELLED' });
    const prisma = {
      reservation: { findUnique },
      restaurant: {
        findFirst: vi.fn().mockResolvedValue({
          timezone: 'Europe/Paris',
          exposureSettings: { maxPartySize: 7, minLeadTimeMinutes: 0, exposedCreneaux: [] },
          floorPlans: [],
        }),
      },
    } as unknown as PrismaClient;
    const limiter = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    } as unknown as McpRateLimiter;
    const registry = new McpToolRegistry(prisma, limiter);
    const reservationService = (
      registry as unknown as {
        reservationService: { cancelReservation: (args: unknown) => Promise<void> };
      }
    ).reservationService;
    vi.spyOn(reservationService, 'cancelReservation').mockRejectedValue(
      Object.assign(new Error('Reservation is already cancelled'), {
        name: 'InvalidStateTransitionError',
      }),
    );

    const result = await registry.cancelReservation(
      { reservationId: RESERVATION_ID, customerPhone: PHONE },
      ctx,
    );

    expect(result).toEqual({ ok: true, data: { cancelled: true } });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

it('returns the one-time hold capability to the caller', async () => {
  const registry = makeRegistry();
  const holdToken = 'a'.repeat(40);
  vi.spyOn(registry, 'createQuoteOrHold').mockResolvedValue({
    ok: true,
    data: { holdToken, expiresAt: '2026-12-01T19:00:00.000Z' },
  });
  const result = await executeTool(registry, 'create_hold', {}, ctx);
  expect(result).toMatchObject({ ok: true, data: { holdToken } });
});

it('rejects tool output containing fields outside its declared schema', async () => {
  const registry = makeRegistry();
  vi.spyOn(registry, 'getReservationStatus').mockResolvedValue({
    ok: true,
    data: {
      id: RESERVATION_ID,
      state: 'CONFIRMED',
      partySize: 2,
      startsAt: '2026-12-01T19:00:00.000Z',
      endsAt: '2026-12-01T21:00:00.000Z',
      createdAt: '2026-09-28T19:00:00.000Z',
      undocumentedField: 'not part of outputSchema',
    },
  });

  const result = await executeTool(registry, 'get_reservation_status', {}, ctx);

  expect(result).toMatchObject({
    ok: false,
    code: 'INTERNAL',
    error: 'Tool output failed schema validation',
  });
});

it('requires public-client proof for an OAuth token scoped to a restaurant', async () => {
  const registry = makeRegistry('agent:client-b');
  const scopedCtx: ToolContext = {
    ...ctx,
    restaurantId: RESTAURANT_ID,
    trustedRestaurantAccess: false,
  };
  const input = { reservationId: RESERVATION_ID, customerPhone: PHONE };

  expect(await registry.getReservationStatus(input, scopedCtx)).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  expect(await registry.cancelReservation(input, scopedCtx)).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
});

it('allows a trusted restaurant API key to read its own restaurant', async () => {
  const registry = makeRegistry('agent:client-b');
  const staffCtx: ToolContext = {
    ...ctx,
    restaurantId: RESTAURANT_ID,
    trustedRestaurantAccess: true,
  };

  expect(
    await registry.getReservationStatus({ reservationId: RESERVATION_ID }, staffCtx),
  ).toMatchObject({ ok: true });
});
