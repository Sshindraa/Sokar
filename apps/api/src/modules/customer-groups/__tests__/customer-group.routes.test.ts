import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerGroupConsentStatus, Prisma } from '@prisma/client';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer test' };

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    accountId: 'test-account-1',
    name: 'Groupe VIP',
    consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    consentedAt: new Date('2026-09-14T10:00:00.000Z'),
    createdByHash: 'hash',
    createdAt: new Date('2026-09-14T10:00:00.000Z'),
    updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    _count: { memberships: 0 },
    ...overrides,
  };
}

describe('customer group foundation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CUSTOMER_GROUPS_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PREMIUM' } as never);
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({
      id: 'test-rest-1',
      accountId: 'test-account-1',
    } as never);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('keeps account-level identity disabled until a pilot opens the flag', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/customer-groups',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'CUSTOMER_GROUPS_DISABLED' });
    expect(db.customerGroupProfile.findMany).not.toHaveBeenCalled();
  });

  it('enforces multi-site entitlement before runtime activation', async () => {
    vi.stubEnv('CUSTOMER_GROUPS_ENABLED', 'true');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/customer-groups',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'customers.group',
    });
  });

  it('creates a group only in the account from the resolved site context', async () => {
    vi.stubEnv('CUSTOMER_GROUPS_ENABLED', 'true');
    vi.mocked(db.customerGroupProfile.create).mockResolvedValue(groupRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/customer-groups',
      headers: { ...AUTH, 'idempotency-key': 'group-create-001' },
      payload: {
        name: '  Groupe   VIP  ',
        consentStatus: 'OPTED_IN',
        accountId: 'attacker-account',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      id: 'group-1',
      accountId: 'test-account-1',
      consentStatus: 'OPTED_IN',
    });
    expect(db.customerGroupProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountId: 'test-account-1', name: 'Groupe VIP' }),
      }),
    );
    expect(JSON.stringify(response.json())).not.toContain('createdByHash');
  });

  it('allows a manager to read groups but reserves consent changes for the owner', async () => {
    vi.stubEnv('CUSTOMER_GROUPS_ENABLED', 'true');
    vi.mocked(db.customerGroupProfile.findMany).mockResolvedValue([groupRow()] as never);
    const app = await getApp();
    const read = await app.inject({
      method: 'GET',
      url: '/customer-groups',
      headers: { ...AUTH, 'x-test-site-role': 'MANAGER' },
    });
    expect(read.statusCode).toBe(200);

    const consent = await app.inject({
      method: 'PATCH',
      url: '/customer-groups/group-1/consent',
      headers: { ...AUTH, 'x-test-site-role': 'MANAGER' },
      payload: { consentStatus: 'OPTED_OUT' },
    });
    expect(consent.statusCode).toBe(403);
    expect(consent.json()).toMatchObject({ error: 'CUSTOMER_GROUP_OWNER_REQUIRED' });
  });

  it('links a consented customer and returns a stable composite membership id', async () => {
    vi.stubEnv('CUSTOMER_GROUPS_ENABLED', 'true');
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      id: 'group-1',
      accountId: 'test-account-1',
      consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: 'test-rest-1',
    } as never);
    vi.mocked(db.customerGroupMembership.findUnique).mockResolvedValue(null);
    vi.mocked(db.customerGroupMembership.create).mockResolvedValue({
      groupProfileId: 'group-1',
      restaurantId: 'test-rest-1',
      customerId: 'customer-1',
    } as never);

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/customer-groups/group-1/members',
      headers: AUTH,
      payload: { customerId: 'customer-1', source: 'pos_exact', confidence: 0.92 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      idempotent: false,
      membershipId: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'customer-1',
          restaurantId: 'test-rest-1',
          restaurant: expect.objectContaining({ accountId: 'test-account-1' }),
        }),
      }),
    );
  });

  it('returns masked member data and never leaks the stored phone', async () => {
    vi.stubEnv('CUSTOMER_GROUPS_ENABLED', 'true');
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      ...groupRow({ _count: undefined }),
      memberships: [
        {
          customerId: 'customer-1',
          restaurantId: 'test-rest-1',
          source: 'MANUAL',
          confidence: new Prisma.Decimal('1.000'),
          createdAt: new Date('2026-09-14T10:00:00.000Z'),
          updatedAt: new Date('2026-09-14T10:00:00.000Z'),
          customer: { id: 'customer-1', name: 'A. Client', phone: '+33612345678' },
        },
      ],
    } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/customer-groups/group-1',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.members[0]).toMatchObject({
      customerName: 'A. Client',
      phoneLast4: '5678',
    });
    expect(JSON.stringify(response.json())).not.toContain('+33612345678');
  });
});
