import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { deleteExperience } from '../experience.service';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  executeRaw: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../../../shared/db/client', () => ({ db: { $transaction: mocks.transaction } }));
const input = { restaurantId: 'restaurant-1', experienceId: 'experience-1' };

describe('experience deletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findFirst.mockResolvedValue({ id: input.experienceId });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: mocks.executeRaw,
        experience: { findFirst: mocks.findFirst, deleteMany: mocks.deleteMany },
      }),
    );
  });
  it('limits the atomic deletion to this tenant, unused drafts and future open dates', async () => {
    await deleteExperience(input);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        id: input.experienceId,
        restaurantId: input.restaurantId,
        status: 'DRAFT',
        reservations: { none: {} },
        checkouts: {
          none: { status: 'OPEN', expiresAt: { gt: expect.any(Date) } },
        },
        sessions: {
          none: { OR: [{ startsAt: { lte: expect.any(Date) } }, { status: { not: 'OPEN' } }] },
        },
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });
  it('refuses deletion when the eligibility predicate no longer matches', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteExperience(input)).rejects.toMatchObject({
      code: 'EXPERIENCE_DELETE_NOT_ALLOWED',
    });
  });
  it('does not delete an experience outside the tenant', async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(deleteExperience(input)).rejects.toMatchObject({ code: 'EXPERIENCE_NOT_FOUND' });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it('reports a concurrent change instead of retrying a destructive operation', async () => {
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '6' }),
    );
    await expect(deleteExperience(input)).rejects.toMatchObject({
      code: 'EXPERIENCE_DELETE_CONFLICT',
    });
  });
});
