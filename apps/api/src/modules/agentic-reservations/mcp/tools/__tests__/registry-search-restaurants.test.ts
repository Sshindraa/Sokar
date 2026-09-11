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
      searchAvailableRestaurants: vi.fn().mockResolvedValue([]),
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
});
