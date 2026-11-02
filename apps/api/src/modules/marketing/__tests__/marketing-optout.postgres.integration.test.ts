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
import { loadOptedOutCustomerIds } from '../marketing-opt-out.service';

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

  it('excludes both profiles sharing an email after one withdraws', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Shared email',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const first = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345672',
        emailNormalized: 'shared@example.test',
      },
    });
    const second = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345673',
        emailNormalized: 'shared@example.test',
      },
    });
    await withdrawMarketingPermission({
      restaurantId: restaurant.id,
      customerId: first.id,
      channel: 'EMAIL',
    });
    const result = await loadOptedOutCustomerIds({
      restaurantId: restaurant.id,
      channel: 'EMAIL',
      customers: [first, second],
    });
    expect(result.checked).toBe(true);
    expect(result.optedOut).toEqual(new Set([first.id, second.id]));
  });

  it('keeps withdrawal proof when a register write fails during a concurrent opt-in', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Failed register race',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone: '+33612345670' },
    });
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_fail_optout() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.5); RAISE EXCEPTION 'simulated register failure'; END;
      $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_optout BEFORE INSERT ON marketing_opt_outs
      FOR EACH ROW WHEN (NEW.source = 'AUDIT_FAIL') EXECUTE FUNCTION audit_fail_optout()`);
    try {
      const withdrawal = withdrawMarketingPermission({
        restaurantId: restaurant.id,
        customerId: customer.id,
        channel: 'SMS',
        source: 'AUDIT_FAIL',
      });
      const failed = expect(withdrawal).rejects.toThrow('MARKETING_OPTOUT_REGISTER_UNAVAILABLE');
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'
        ) AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      const optIn = upsertMarketingPermission({
        restaurantId: restaurant.id,
        customerId: customer.id,
        channel: 'SMS',
        status: 'OPTED_IN',
        source: 'AUDIT_OPT_IN',
        proofVersion: 'test',
        proof: 'test',
      });
      await Promise.all([failed, optIn]);
      const permission = await db.marketingPermission.findUniqueOrThrow({
        where: { customerId_channel: { customerId: customer.id, channel: 'SMS' } },
      });
      expect(permission.status).toBe('OPTED_IN');
      expect(
        await db.marketingPermissionEvent.count({
          where: { restaurantId: restaurant.id, customerId: customer.id, source: 'AUDIT_FAIL' },
        }),
      ).toBe(1);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_fail_optout ON marketing_opt_outs');
      await db.$executeRawUnsafe('DROP FUNCTION audit_fail_optout()');
    }
  });

  it('rolls back the withdrawal if its proof cannot be saved', async () => {
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Failed proof',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone: '+33612345671' },
    });
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_fail_proof() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated proof failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_proof BEFORE INSERT ON marketing_permission_events
      FOR EACH ROW WHEN (NEW.source = 'AUDIT_PROOF_FAIL') EXECUTE FUNCTION audit_fail_proof()`);
    try {
      await expect(
        withdrawMarketingPermission({
          restaurantId: restaurant.id,
          customerId: customer.id,
          channel: 'SMS',
          source: 'AUDIT_PROOF_FAIL',
        }),
      ).rejects.toThrow();
      expect(
        await db.marketingPermission.count({
          where: { restaurantId: restaurant.id, customerId: customer.id },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_fail_proof ON marketing_permission_events');
      await db.$executeRawUnsafe('DROP FUNCTION audit_fail_proof()');
    }
  });
});
