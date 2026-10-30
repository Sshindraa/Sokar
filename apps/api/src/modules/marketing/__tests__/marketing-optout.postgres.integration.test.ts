import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.unmock('@prisma/client');
vi.unmock('../../../shared/db/client');

import { db } from '../../../shared/db/client';
import {
  upsertMarketingPermission,
  withdrawMarketingPermission,
} from '../marketing-permission.service';
import { previewMarketingAudience } from '../marketing-campaign.service';

const url = process.env.MARKETING_OPTOUT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_optout_audit_[a-z0-9_]+$/.test(target.pathname) ||
    process.env.DATABASE_URL !== url
  ) {
    throw new Error('Marketing opt-out tests require the dedicated local database');
  }
}

describe.skipIf(!url)('marketing opt-out on PostgreSQL', () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  it('blocks a recreated profile and reports a register failure without unblocking the current profile', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const tag = randomUUID();
    const phone = '+33612345678';
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Opt-out test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const original = await db.customer.create({
      data: { restaurantId: restaurant.id, phone, isVip: true },
    });
    await withdrawMarketingPermission({
      restaurantId: restaurant.id,
      customerId: original.id,
      channel: 'SMS',
    });
    await db.customer.delete({ where: { id: original.id } });
    const recreated = await db.customer.create({
      data: { restaurantId: restaurant.id, phone, isVip: true },
    });
    await db.marketingPermission.create({
      data: {
        restaurantId: restaurant.id,
        customerId: recreated.id,
        channel: 'SMS',
        status: 'OPTED_IN',
        source: 'SYNTHETIC_IMPORT',
      },
    });
    const preview = await previewMarketingAudience({
      restaurantId: restaurant.id,
      channel: 'SMS',
      definition: {
        version: 1,
        operator: 'AND',
        conditions: [{ field: 'isVip', op: 'EQ', value: true }],
      },
    });
    expect(preview.eligibleCount).toBe(0);
    expect(preview.excludedByReason.OPTED_OUT_REGISTER).toBe(1);
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
    await expect(
      withdrawMarketingPermission({
        restaurantId: restaurant.id,
        customerId: recreated.id,
        channel: 'SMS',
      }),
    ).rejects.toThrow('MARKETING_OPTOUT_REGISTER_UNAVAILABLE');
    expect(
      (
        await db.marketingPermission.findUniqueOrThrow({
          where: { customerId_channel: { customerId: recreated.id, channel: 'SMS' } },
        })
      ).status,
    ).toBe('OPTED_OUT');
  });
  it('keeps permission and register consistent when consent and withdrawal race', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const tag = randomUUID();
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Race test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone: '+33612345679' },
    });
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        withdrawMarketingPermission({
          restaurantId: restaurant.id,
          customerId: customer.id,
          channel: 'SMS',
        }),
        upsertMarketingPermission({
          restaurantId: restaurant.id,
          customerId: customer.id,
          channel: 'SMS',
          status: 'OPTED_IN',
          source: 'TEST',
          proofVersion: 'test',
          proof: 'test',
        }),
      ]);
      const permission = await db.marketingPermission.findUniqueOrThrow({
        where: { customerId_channel: { customerId: customer.id, channel: 'SMS' } },
      });
      const registered = await db.marketingOptOut.count({
        where: { restaurantId: restaurant.id, channel: 'SMS' },
      });
      expect(registered).toBe(permission.status === 'OPTED_OUT' ? 1 : 0);
    }
  });
});
