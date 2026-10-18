import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { resolveAccountOwnerEmail } from '../account-email.service';

const getUser = vi.hoisted(() => vi.fn());
vi.mock('@clerk/fastify', () => ({ clerkClient: { users: { getUser } } }));

function user(
  addresses: Array<{ id: string; emailAddress: string; status: string }>,
  primary: string | null,
) {
  return {
    primaryEmailAddressId: primary,
    emailAddresses: addresses.map((address) => ({
      id: address.id,
      emailAddress: address.emailAddress,
      verification: { status: address.status },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.restaurantAccountMembership.findFirst).mockResolvedValue({
    clerkUserId: 'user_owner',
  } as never);
});

describe('resolveAccountOwnerEmail', () => {
  it('renvoie l’adresse principale vérifiée du propriétaire', async () => {
    getUser.mockResolvedValue(
      user(
        [
          { id: 'a1', emailAddress: 'secondaire@example.com', status: 'verified' },
          { id: 'a2', emailAddress: 'principale@example.com', status: 'verified' },
        ],
        'a2',
      ),
    );

    expect(await resolveAccountOwnerEmail('acc-1')).toBe('principale@example.com');
    expect(db.restaurantAccountMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 'acc-1', role: 'OWNER', restaurantId: null } }),
    );
    expect(getUser).toHaveBeenCalledWith('user_owner');
  });

  it('refuse une adresse non vérifiée', async () => {
    getUser.mockResolvedValue(
      user([{ id: 'a1', emailAddress: 'inconnue@example.com', status: 'unverified' }], 'a1'),
    );

    expect(await resolveAccountOwnerEmail('acc-1')).toBeNull();
  });

  it('renvoie null sans adresse principale', async () => {
    getUser.mockResolvedValue(
      user([{ id: 'a1', emailAddress: 'a@example.com', status: 'verified' }], null),
    );

    expect(await resolveAccountOwnerEmail('acc-1')).toBeNull();
  });

  it('renvoie null sans compte, sans propriétaire, ou si Clerk échoue', async () => {
    expect(await resolveAccountOwnerEmail(null)).toBeNull();
    expect(await resolveAccountOwnerEmail(undefined)).toBeNull();
    expect(getUser).not.toHaveBeenCalled();

    vi.mocked(db.restaurantAccountMembership.findFirst).mockResolvedValueOnce(null);
    expect(await resolveAccountOwnerEmail('acc-1')).toBeNull();

    getUser.mockRejectedValue(new Error('Clerk indisponible'));
    expect(await resolveAccountOwnerEmail('acc-1')).toBeNull();
  });
});
