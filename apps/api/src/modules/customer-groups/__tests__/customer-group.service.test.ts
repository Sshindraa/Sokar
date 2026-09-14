import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerGroupConsentStatus, Prisma } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  createCustomerGroup,
  CustomerGroupConflictError,
  CustomerGroupCustomerNotFoundError,
  CustomerGroupInputError,
  getCustomerGroup,
  linkCustomerToGroup,
  listCustomerGroups,
  unlinkCustomerFromGroup,
  updateCustomerGroupConsent,
} from '../customer-group.service';

const ACCOUNT_ID = 'account-1';
const SITE_ID = 'site-1';

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    accountId: ACCOUNT_ID,
    name: 'Groupe VIP',
    consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    consentedAt: new Date('2026-09-14T10:00:00.000Z'),
    createdByHash: 'hash',
    createdAt: new Date('2026-09-14T10:00:00.000Z'),
    updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    _count: { memberships: 1 },
    ...overrides,
  };
}

describe('customer group service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({
      id: SITE_ID,
      accountId: ACCOUNT_ID,
    } as never);
  });

  it('creates a normalized account-level group and records consent time', async () => {
    vi.mocked(db.customerGroupProfile.create).mockResolvedValue(groupRow() as never);

    const result = await createCustomerGroup({
      accountId: ACCOUNT_ID,
      restaurantId: SITE_ID,
      name: '  Groupe   VIP  ',
      consentStatus: CustomerGroupConsentStatus.OPTED_IN,
      actor: 'user-1:site-1',
    });

    expect(result).toMatchObject({
      id: 'group-1',
      accountId: ACCOUNT_ID,
      memberCount: 1,
      consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    });
    expect(db.customerGroupProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: ACCOUNT_ID,
          name: 'Groupe VIP',
          consentStatus: CustomerGroupConsentStatus.OPTED_IN,
          consentedAt: expect.any(Date),
          createdByHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('replays a group creation by its account-scoped idempotency key', async () => {
    vi.mocked(db.customerGroupProfile.findUnique).mockResolvedValue(groupRow() as never);

    const result = await createCustomerGroup({
      accountId: ACCOUNT_ID,
      restaurantId: SITE_ID,
      name: 'Groupe VIP',
      idempotencyKey: 'group-create-001',
      actor: 'user-1:site-1',
    });

    expect(result.id).toBe('group-1');
    expect(db.customerGroupProfile.create).not.toHaveBeenCalled();
    expect(db.customerGroupProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/) },
      }),
    );
  });

  it('refuses account-less access before querying group data', async () => {
    await expect(
      listCustomerGroups({ accountId: undefined, restaurantId: SITE_ID }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_GROUP_ACCOUNT_REQUIRED' });
    expect(db.restaurant.findFirst).not.toHaveBeenCalled();
    expect(db.customerGroupProfile.findMany).not.toHaveBeenCalled();
  });

  it('masks phone data when returning group members', async () => {
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      ...groupRow({ _count: undefined }),
      memberships: [
        {
          customerId: 'customer-1',
          restaurantId: SITE_ID,
          source: 'POS_EXACT',
          confidence: new Prisma.Decimal('0.875'),
          createdAt: new Date('2026-09-14T10:00:00.000Z'),
          updatedAt: new Date('2026-09-14T10:00:00.000Z'),
          customer: { id: 'customer-1', name: 'A. Client', phone: '+33612345678' },
        },
      ],
    } as never);

    const result = await getCustomerGroup({
      accountId: ACCOUNT_ID,
      restaurantId: SITE_ID,
      groupId: 'group-1',
    });

    expect(result.memberCount).toBe(1);
    expect(result.members[0]).toMatchObject({
      customerId: 'customer-1',
      customerName: 'A. Client',
      phoneLast4: '5678',
      confidence: '0.875',
    });
    expect(JSON.stringify(result)).not.toContain('+33612345678');
  });

  it('requires explicit inter-site consent before linking', async () => {
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      id: 'group-1',
      accountId: ACCOUNT_ID,
      consentStatus: CustomerGroupConsentStatus.UNKNOWN,
    } as never);

    await expect(
      linkCustomerToGroup({
        accountId: ACCOUNT_ID,
        restaurantId: SITE_ID,
        groupId: 'group-1',
        customerId: 'customer-1',
        source: 'POS_EXACT',
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_GROUP_CONSENT_REQUIRED' });
    expect(db.customer.findFirst).not.toHaveBeenCalled();
  });

  it('links a customer idempotently and rejects a second group', async () => {
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      id: 'group-1',
      accountId: ACCOUNT_ID,
      consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: SITE_ID,
    } as never);
    vi.mocked(db.customerGroupMembership.findUnique)
      .mockResolvedValueOnce({
        groupProfileId: 'group-1',
        restaurantId: SITE_ID,
        customerId: 'customer-1',
      } as never)
      .mockResolvedValueOnce({
        groupProfileId: 'group-2',
        restaurantId: SITE_ID,
        customerId: 'customer-1',
      } as never);

    const idempotent = await linkCustomerToGroup({
      accountId: ACCOUNT_ID,
      restaurantId: SITE_ID,
      groupId: 'group-1',
      customerId: 'customer-1',
      source: 'POS_EXACT',
    });
    expect(idempotent).toMatchObject({ idempotent: true, membershipId: expect.any(String) });

    await expect(
      linkCustomerToGroup({
        accountId: ACCOUNT_ID,
        restaurantId: SITE_ID,
        groupId: 'group-1',
        customerId: 'customer-1',
        source: 'POS_EXACT',
      }),
    ).rejects.toBeInstanceOf(CustomerGroupConflictError);
  });

  it('rejects invalid confidence and customers outside the active site', async () => {
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      id: 'group-1',
      accountId: ACCOUNT_ID,
      consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue(null);

    await expect(
      linkCustomerToGroup({
        accountId: ACCOUNT_ID,
        restaurantId: SITE_ID,
        groupId: 'group-1',
        customerId: 'customer-other-site',
        source: 'POS_EXACT',
        confidence: 0.9,
      }),
    ).rejects.toBeInstanceOf(CustomerGroupCustomerNotFoundError);

    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: SITE_ID,
    } as never);
    vi.mocked(db.customerGroupMembership.findUnique).mockResolvedValue(null);
    await expect(
      linkCustomerToGroup({
        accountId: ACCOUNT_ID,
        restaurantId: SITE_ID,
        groupId: 'group-1',
        customerId: 'customer-1',
        source: 'POS_EXACT',
        confidence: 1.1,
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_GROUP_CONFIDENCE_INVALID' });
  });

  it('updates consent and unlinks only the active site membership', async () => {
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({ id: 'group-1' } as never);
    vi.mocked(db.customerGroupProfile.update).mockResolvedValue(
      groupRow({
        consentStatus: CustomerGroupConsentStatus.OPTED_OUT,
        consentedAt: null,
        _count: { memberships: 0 },
      }) as never,
    );
    const updated = await updateCustomerGroupConsent({
      accountId: ACCOUNT_ID,
      restaurantId: SITE_ID,
      groupId: 'group-1',
      consentStatus: CustomerGroupConsentStatus.OPTED_OUT,
    });
    expect(updated.consentStatus).toBe(CustomerGroupConsentStatus.OPTED_OUT);
    expect(db.customerGroupProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'group-1' },
        data: { consentStatus: CustomerGroupConsentStatus.OPTED_OUT, consentedAt: null },
      }),
    );

    vi.mocked(db.customerGroupMembership.findFirst).mockResolvedValue({
      groupProfileId: 'group-1',
      restaurantId: SITE_ID,
      customerId: 'customer-1',
    } as never);
    const result = await unlinkCustomerFromGroup({
      accountId: ACCOUNT_ID,
      restaurantId: SITE_ID,
      groupId: 'group-1',
      customerId: 'customer-1',
    });
    expect(result).toEqual({ removed: true });
    expect(db.customerGroupMembership.delete).toHaveBeenCalledWith({
      where: {
        groupProfileId_restaurantId_customerId: {
          groupProfileId: 'group-1',
          restaurantId: SITE_ID,
          customerId: 'customer-1',
        },
      },
    });
  });

  it('validates source before writing a new membership', async () => {
    vi.mocked(db.customerGroupProfile.findFirst).mockResolvedValue({
      id: 'group-1',
      accountId: ACCOUNT_ID,
      consentStatus: CustomerGroupConsentStatus.OPTED_IN,
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: SITE_ID,
    } as never);

    await expect(
      linkCustomerToGroup({
        accountId: ACCOUNT_ID,
        restaurantId: SITE_ID,
        groupId: 'group-1',
        customerId: 'customer-1',
        source: 'manual source',
      }),
    ).rejects.toBeInstanceOf(CustomerGroupInputError);
    expect(db.customerGroupMembership.create).not.toHaveBeenCalled();
  });
});
