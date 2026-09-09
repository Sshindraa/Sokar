import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { McpToolRegistry } from '../registry';
import { McpRateLimiter } from '../../rate-limit';
import { renderMetrics } from '../../../../../shared/observability/metrics';

const makePrisma = () =>
  ({
    restaurant: {
      findFirst: vi.fn().mockResolvedValue({
        timezone: 'Europe/Paris',
        exposureSettings: {
          maxPartySize: 12,
          minLeadTimeMinutes: 0,
          exposedCreneaux: [],
        },
      } as unknown as Awaited<ReturnType<PrismaClient['restaurant']['findFirst']>>),
    },
    reservation: { count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb: unknown) =>
      (cb as (tx: Record<string, unknown>) => Promise<unknown>)({}),
    ),
  }) as unknown as PrismaClient;

const makeRateLimiter = () =>
  ({
    check: vi.fn().mockResolvedValue({ allowed: true }),
  }) as unknown as McpRateLimiter;

describe('McpToolRegistry.checkAvailability metrics', () => {
  it("observe la durée même en cas d'erreur métier", async () => {
    const beforePayload = await renderMetrics();
    const beforeMatch = beforePayload.match(
      /sokar_agentic_check_availability_duration_ms_count (\d+)/,
    );
    const before = beforeMatch ? parseInt(beforeMatch[1], 10) : 0;

    const prisma = makePrisma();
    const registry = new McpToolRegistry(prisma, makeRateLimiter());

    // Simule un service qui throw
    (registry as unknown as Record<string, unknown>).availabilityService = {
      checkAvailability: vi.fn().mockRejectedValue(new Error('DB down')),
    };

    const result = await registry.checkAvailability(
      {
        restaurantId: '550e8400-e29b-41d4-a716-446655440000',
        partySize: 2,
        slotStart: '2026-12-01T19:00:00Z',
        slotEnd: '2026-12-01T21:00:00Z',
      },
      {
        clientId: 'c1',
        clientName: 'test',
        restaurantId: null,
        scopes: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
        actor: 'test',
      },
    );

    const afterPayload = await renderMetrics();
    const afterMatch = afterPayload.match(
      /sokar_agentic_check_availability_duration_ms_count (\d+)/,
    );
    const after = afterMatch ? parseInt(afterMatch[1], 10) : 0;

    if (result.ok) {
      throw new Error('Expected checkAvailability to return a tool error');
    }
    expect(result.code).toBe('INTERNAL');
    expect(after).toBe(before + 1);
  });

  it('convertit un horaire local MCP dans le fuseau du restaurant', async () => {
    const prisma = makePrisma();
    const registry = new McpToolRegistry(prisma, makeRateLimiter());
    const checkAvailability = vi.fn().mockResolvedValue({ available: true });
    (registry as unknown as Record<string, unknown>).availabilityService = {
      checkAvailability,
    };

    const result = await registry.checkAvailability(
      {
        restaurantId: '550e8400-e29b-41d4-a716-446655440000',
        partySize: 2,
        slotStart: '2026-09-10T20:00:00',
        slotEnd: '2026-09-10T22:00:00',
      },
      {
        clientId: 'c1',
        clientName: 'test',
        restaurantId: null,
        scopes: ['mcp:read'],
        actor: 'test',
      },
    );

    expect(result).toEqual({ ok: true, data: { available: true } });
    expect(checkAvailability).toHaveBeenCalledWith({
      restaurantId: '550e8400-e29b-41d4-a716-446655440000',
      partySize: 2,
      slotStart: new Date('2026-09-10T18:00:00.000Z'),
      slotEnd: new Date('2026-09-10T20:00:00.000Z'),
    });
  });

  it('retourne une erreur explicite pour un horaire local inexistant', async () => {
    const prisma = makePrisma();
    const registry = new McpToolRegistry(prisma, makeRateLimiter());
    const checkAvailability = vi.fn();
    (registry as unknown as Record<string, unknown>).availabilityService = {
      checkAvailability,
    };

    const result = await registry.checkAvailability(
      {
        restaurantId: '550e8400-e29b-41d4-a716-446655440000',
        partySize: 2,
        slotStart: '2026-03-29T02:30:00',
        slotEnd: '2026-03-29T04:00:00',
      },
      {
        clientId: 'c1',
        clientName: 'test',
        restaurantId: null,
        scopes: ['mcp:read'],
        actor: 'test',
      },
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_DATETIME' });
    expect(checkAvailability).not.toHaveBeenCalled();
  });
});
