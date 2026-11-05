import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canHoldSlot, SLOT_HOLD_LIMIT } from '../hold-slot-limit';

const counters = vi.hoisted(() => new Map<string, number>());

vi.mock('../../../../shared/redis/client', () => ({
  redisCache: {
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  },
}));

const SLOT = new Date('2026-11-10T19:00:00Z');

describe('canHoldSlot', () => {
  beforeEach(() => counters.clear());

  it('refuse le hold au-delà de la limite pour un même client et créneau', async () => {
    for (let i = 0; i < SLOT_HOLD_LIMIT; i++) {
      expect(
        await canHoldSlot({ restaurantId: 'r1', slotStart: SLOT, clientIp: '203.0.113.1' }),
      ).toBe(true);
    }
    expect(
      await canHoldSlot({ restaurantId: 'r1', slotStart: SLOT, clientIp: '203.0.113.1' }),
    ).toBe(false);
  });

  it('un autre client garde son quota sur le même créneau', async () => {
    for (let i = 0; i < SLOT_HOLD_LIMIT; i++) {
      await canHoldSlot({ restaurantId: 'r1', slotStart: SLOT, clientIp: '203.0.113.1' });
    }
    expect(
      await canHoldSlot({ restaurantId: 'r1', slotStart: SLOT, clientIp: '203.0.113.2' }),
    ).toBe(true);
  });

  it('un autre créneau du même restaurant reste disponible', async () => {
    for (let i = 0; i < SLOT_HOLD_LIMIT; i++) {
      await canHoldSlot({ restaurantId: 'r1', slotStart: SLOT, clientIp: '203.0.113.1' });
    }
    const other = new Date('2026-11-10T20:00:00Z');
    expect(
      await canHoldSlot({ restaurantId: 'r1', slotStart: other, clientIp: '203.0.113.1' }),
    ).toBe(true);
  });
});
