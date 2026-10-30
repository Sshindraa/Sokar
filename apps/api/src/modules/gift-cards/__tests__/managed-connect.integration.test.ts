import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import * as stripe from '../stripe.service';

const url = process.env.MANAGED_CONNECT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.pathname !== '/sokar_stripe_managed_test'
  ) {
    throw new Error('Managed Connect tests require their dedicated local database');
  }
}

describe.skipIf(!url)('managed Connect with PostgreSQL', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    prisma = new actual.PrismaClient({ datasources: { db: { url: url! } } });
    await prisma.restaurant.create({
      data: {
        id: 'test-rest-1',
        name: 'Test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: 'test-managed-connect',
        openingHours: {},
      },
    });
  });
  afterAll(async () => {
    await prisma.restaurant.delete({ where: { id: 'test-rest-1' } });
    await prisma.$disconnect();
    await closeApp();
  });

  it('serializes concurrent requests and preserves a single connected account', async () => {
    vi.spyOn(stripe, 'managedConnectTestEnabled').mockReturnValue(true);
    const create = vi.spyOn(stripe, 'createManagedTestAccount').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'acct_testManaged';
    });
    const configure = vi.spyOn(stripe, 'configureManagedTestAccount').mockResolvedValue();
    vi.spyOn(stripe, 'isManagedTestAccount').mockResolvedValue(true);
    vi.spyOn(stripe, 'createManagedTestSession').mockResolvedValue({
      clientSecret: 'mock',
      publishableKey: 'pk_test',
    });
    vi.mocked(db.$transaction).mockImplementation(((
      fn: Parameters<PrismaClient['$transaction']>[0],
      options: object,
    ) => prisma.$transaction(fn as never, options)) as never);
    const app = await getApp();
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/gift-cards/stripe-connect/managed-test',
        headers: { authorization: 'Bearer fake-token' },
        payload: { accountToken: ['accttok', 'example'].join('_') },
      });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledTimes(1);
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: 'test-rest-1' } });
    expect(restaurant.giftCardStripeAccountId).toBe('acct_testManaged');
    expect(restaurant.giftCardStripePendingAccountId).toBeNull();
  });

  it('reuses the pending account after a configuration failure', async () => {
    vi.clearAllMocks();
    await prisma.restaurant.update({
      where: { id: 'test-rest-1' },
      data: { giftCardStripeAccountId: null, giftCardStripePendingAccountId: null },
    });
    vi.spyOn(stripe, 'managedConnectTestEnabled').mockReturnValue(true);
    const create = vi
      .spyOn(stripe, 'createManagedTestAccount')
      .mockResolvedValue('acct_testPending');
    const configure = vi
      .spyOn(stripe, 'configureManagedTestAccount')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue();
    vi.spyOn(stripe, 'isManagedTestAccount').mockResolvedValue(true);
    vi.spyOn(stripe, 'createManagedTestSession').mockResolvedValue({
      clientSecret: 'mock',
      publishableKey: 'pk_test',
    });
    vi.mocked(db.$transaction).mockImplementation(((
      fn: Parameters<PrismaClient['$transaction']>[0],
      options: object,
    ) => prisma.$transaction(fn as never, options)) as never);
    const app = await getApp();
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/gift-cards/stripe-connect/managed-test',
        headers: { authorization: 'Bearer fake-token' },
        payload: { accountToken: ['accttok', 'example'].join('_') },
      });
    expect((await request()).statusCode).toBe(503);
    const pending = await prisma.restaurant.findUniqueOrThrow({ where: { id: 'test-rest-1' } });
    expect(pending.giftCardStripePendingAccountId).toBe('acct_testPending');
    expect((await request()).statusCode).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledTimes(2);
  });
});
