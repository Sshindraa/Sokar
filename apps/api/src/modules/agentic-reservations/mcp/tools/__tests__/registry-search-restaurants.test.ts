import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { McpToolRegistry } from '../registry';
import { McpRateLimiter } from '../../rate-limit';

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
        floorPlans: [{ tables: [{ capacity: 6 }] }],
      }),
    },
    reservationAuditLog: { create: vi.fn().mockResolvedValue({}) },
  }) as unknown as PrismaClient;

const makeRateLimiter = () =>
  ({ check: vi.fn().mockResolvedValue({ allowed: true }) }) as unknown as McpRateLimiter;

describe('McpToolRegistry.searchRestaurants capacity guidance', () => {
  it('renvoie la capacité en ligne au lieu de laisser le client conclure à tort que le restaurant est introuvable', async () => {
    const registry = new McpToolRegistry(makePrisma(), makeRateLimiter());
    const availabilityService = {
      searchAvailableRestaurantsPage: vi.fn().mockResolvedValue({ results: [] }),
      findCapacityLimits: vi.fn().mockResolvedValue([
        {
          restaurantId: 'restaurant-1',
          name: 'Chez Sokar',
          slug: 'chez-sokar',
          maxOnlinePartySize: 6,
        },
      ]),
    };
    (registry as unknown as Record<string, unknown>).availabilityService = availabilityService;

    const result = await registry.searchRestaurants(
      {
        city: 'Lyon',
        partySize: 20,
        slotStart: '2026-09-17T20:00:00+02:00',
        slotEnd: '2026-09-17T22:00:00+02:00',
      },
      {
        clientId: 'client-1',
        clientName: 'Claude',
        restaurantId: null,
        scopes: ['mcp:read'],
        actor: 'test',
      },
    );

    expect(result).toEqual({
      ok: true,
      data: {
        restaurants: [],
        capacityLimits: [
          {
            id: 'restaurant-1',
            name: 'Chez Sokar',
            slug: 'chez-sokar',
            maxOnlinePartySize: 6,
          },
        ],
        nextCursor: undefined,
      },
    });
    expect(availabilityService.findCapacityLimits).toHaveBeenCalledWith({
      city: 'Lyon',
      partySize: 20,
      cuisineType: undefined,
      maxResults: 5,
    });
  });

  it('continues past filtered restaurants and consumes the cursor', async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.restaurant.findFirst).mockResolvedValueOnce(null);
    const registry = new McpToolRegistry(prisma, makeRateLimiter());
    const restaurantId = '550e8400-e29b-41d4-a716-446655440003';
    const availabilityService = {
      searchAvailableRestaurantsPage: vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            {
              restaurantId: '550e8400-e29b-41d4-a716-446655440001',
              name: 'Hidden',
              slug: 'hidden',
            },
          ],
          nextCursor: '550e8400-e29b-41d4-a716-446655440002',
        })
        .mockResolvedValueOnce({
          results: [{ restaurantId, name: 'Chez Sokar', slug: 'chez-sokar' }],
        }),
      findCapacityLimits: vi.fn(),
    };
    (registry as unknown as Record<string, unknown>).availabilityService = availabilityService;
    const result = await registry.searchRestaurants(
      {
        city: 'Lyon',
        partySize: 2,
        slotStart: '2026-12-17T20:00:00+01:00',
        slotEnd: '2026-12-17T22:00:00+01:00',
        maxResults: 1,
      },
      {
        clientId: 'client-1',
        clientName: 'Claude',
        restaurantId: null,
        scopes: ['mcp:read'],
        actor: 'agent:client-1',
      },
    );
    expect(result).toMatchObject({
      ok: true,
      data: { restaurants: [{ id: restaurantId }], nextCursor: undefined },
    });
    expect(availabilityService.searchAvailableRestaurantsPage).toHaveBeenCalledTimes(2);
    expect(availabilityService.searchAvailableRestaurantsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: '550e8400-e29b-41d4-a716-446655440002' }),
    );
  });
});
