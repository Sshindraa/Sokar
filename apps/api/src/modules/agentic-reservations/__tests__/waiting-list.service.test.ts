/**
 * Tests unitaires du WaitingListService avec un faux PrismaClient.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, type Reservation, type WaitingListEntry } from '@prisma/client';
import type { WaitingListStatus } from '@prisma/client';
import { WaitingListService } from '../core/waiting-list.service.js';
import { AuditLogService } from '../core/audit-log.service.js';
import {
  WaitingListAlreadyExistsError,
  WaitingListAlreadyPromotedError,
  WaitingListDisabledError,
  WaitingListEntryNotFoundError,
  WaitingListSlotFullError,
} from '../core/waiting-list.errors.js';
import type { TableAllocationService } from '../../floor-plan/table-allocation.service.js';

vi.mock('../workers/queues.js', () => ({
  scheduleWaitingListExpiration: vi.fn(),
  scheduleWaitingListPromotionNotification: vi.fn(),
}));

import {
  scheduleWaitingListExpiration,
  scheduleWaitingListPromotionNotification,
} from '../workers/queues.js';

type WaitingListRow = WaitingListEntry;
type ReservationRow = Reservation;

function matchesWhere(entry: WaitingListRow, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && entry.id !== where.id) return false;
  if (where.restaurantId !== undefined && entry.restaurantId !== where.restaurantId) return false;

  if (where.status !== undefined) {
    if (typeof where.status === 'string') {
      if (entry.status !== where.status) return false;
    } else if (where.status && typeof where.status === 'object') {
      const statusObj = where.status as Record<string, unknown>;
      const inArr = statusObj.in as string[] | undefined;
      if (inArr && !inArr.includes(entry.status)) return false;
    }
  }

  if (where.actionTokenHash !== undefined && entry.actionTokenHash !== where.actionTokenHash)
    return false;

  if (where.slotStart !== undefined) {
    if (where.slotStart instanceof Date) {
      if (entry.slotStart.getTime() !== where.slotStart.getTime()) return false;
    } else if (typeof where.slotStart === 'object') {
      const slotObj = where.slotStart as Record<string, Date>;
      if (slotObj.gte && entry.slotStart.getTime() < slotObj.gte.getTime()) return false;
      if (slotObj.lt && entry.slotStart.getTime() >= slotObj.lt.getTime()) return false;
      if (slotObj.gt && entry.slotStart.getTime() <= slotObj.gt.getTime()) return false;
      if (slotObj.lte && entry.slotStart.getTime() > slotObj.lte.getTime()) return false;
    }
  }

  if (where.expiresAt !== undefined && typeof where.expiresAt === 'object') {
    const expObj = where.expiresAt as Record<string, Date>;
    if (expObj.gt && entry.expiresAt.getTime() <= expObj.gt.getTime()) return false;
    if (expObj.gte && entry.expiresAt.getTime() < expObj.gte.getTime()) return false;
    if (expObj.lt && entry.expiresAt.getTime() >= expObj.lt.getTime()) return false;
    if (expObj.lte && entry.expiresAt.getTime() > expObj.lte.getTime()) return false;
  }

  return true;
}

function sortEntries(
  arr: WaitingListRow[],
  orderBy: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>,
): WaitingListRow[] {
  const keys: Array<{ key: keyof WaitingListRow; dir: 'asc' | 'desc' }> = [];
  const sources = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const src of sources) {
    for (const [key, dir] of Object.entries(src)) {
      keys.push({ key: key as keyof WaitingListRow, dir: dir as 'asc' | 'desc' });
    }
  }

  return [...arr].sort((a, b) => {
    for (const { key, dir } of keys) {
      const av = a[key];
      const bv = b[key];
      const va = av instanceof Date ? av.getTime() : (av as number | string);
      const vb = bv instanceof Date ? bv.getTime() : (bv as number | string);
      if (va === vb) continue;
      const cmp = va < vb ? -1 : 1;
      return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function makeFakes() {
  const entries = new Map<string, WaitingListRow>();
  const reservations = new Map<string, ReservationRow>();
  const audits: Record<string, unknown>[] = [];

  const prisma = {
    $transaction: async (fn: unknown, _options?: unknown) =>
      (fn as (tx: PrismaClient) => Promise<unknown>)(prisma as unknown as PrismaClient),
    $executeRaw: async (_query: unknown) => 0,
    $queryRaw: async (_query: unknown) => [] as unknown[],

    waitingListEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const restaurantId = data.restaurantId as string;
        const customerPhoneNormalized = data.customerPhoneNormalized as string;
        const slotStart = data.slotStart as Date;
        const status = data.status as WaitingListStatus;

        // Partial unique index simulation : (restaurantId, customerPhoneNormalized, slotStart) WHERE PENDING
        if (status === 'PENDING') {
          for (const e of entries.values()) {
            if (
              e.restaurantId === restaurantId &&
              e.customerPhoneNormalized === customerPhoneNormalized &&
              e.slotStart.getTime() === slotStart.getTime() &&
              e.status === 'PENDING'
            ) {
              throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: 'test',
              });
            }
          }
        }

        // action_token_hash is globally unique
        const actionTokenHash = data.actionTokenHash as string;
        for (const e of entries.values()) {
          if (e.actionTokenHash === actionTokenHash) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
        }

        const id = `wl-${entries.size + 1}`;
        const row: WaitingListRow = {
          id,
          restaurantId,
          partySize: data.partySize as number,
          customerFirstName: data.customerFirstName as string,
          customerLastName: (data.customerLastName as string | null | undefined) ?? null,
          customerPhone: data.customerPhone as string,
          customerPhoneNormalized,
          customerEmail: (data.customerEmail as string | null | undefined) ?? null,
          source: (data.source as string | null | undefined) ?? null,
          slotStart,
          slotEnd: data.slotEnd as Date,
          preferredSectionId: (data.preferredSectionId as string | null | undefined) ?? null,
          status,
          position: data.position as number,
          actionTokenHash,
          promotedReservationId: (data.promotedReservationId as string | null | undefined) ?? null,
          expiresAt: data.expiresAt as Date,
          promotedAt: (data.promotedAt as Date | null | undefined) ?? null,
          cancelledAt: (data.cancelledAt as Date | null | undefined) ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as WaitingListRow;
        entries.set(id, row);
        return row;
      },
      count: async ({ where }: { where: Record<string, unknown> }) => {
        let n = 0;
        for (const e of entries.values()) {
          if (matchesWhere(e, where)) n++;
        }
        return n;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        for (const e of entries.values()) {
          if (matchesWhere(e, where)) return e;
        }
        return null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => entries.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const e = entries.get(where.id);
        if (!e) throw new Error('not found');
        return e;
      },
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
        take?: number;
      }) => {
        let out = [...entries.values()].filter((e) => matchesWhere(e, where));
        if (orderBy) out = sortEntries(out, orderBy);
        if (take !== undefined && take >= 0) out = out.slice(0, take);
        return out;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const e = entries.get(where.id);
        if (!e) throw new Error('not found');
        Object.assign(e, data);
        return e;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const e of entries.values()) {
          if (matchesWhere(e, where)) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      },
    },

    reservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `res-${reservations.size + 1}`;
        const row: ReservationRow = {
          id,
          restaurantId: data.restaurantId as string,
          callId: null,
          customerId: (data.customerId as string | null | undefined) ?? null,
          reservedAt: data.reservedAt as Date,
          partySize: data.partySize as number,
          customerName: data.customerName as string,
          customerPhone: (data.customerPhone as string | null | undefined) ?? null,
          status: data.status as string,
          estimatedRevenue: null,
          confirmedRevenue: null,
          googleEventId: null,
          createdAt: new Date(),
          channel: data.channel as string,
          state: data.state as string,
          startsAt: data.startsAt as Date | null,
          endsAt: data.endsAt as Date | null,
          specialRequests: null,
          createdByClient: null,
          cancellationPolicySnap: null,
          noShowPolicySnap: null,
          consents: data.consents as object,
          privacyPolicyVersion: data.privacyPolicyVersion as string,
          idempotencyScope: null,
          idempotencyKey: null,
          consumedHoldId: null,
          source: data.source as string | null,
          confirmationStatus: 'NOT_REQUIRED',
          confirmationSentAt: null,
          confirmedAt: null,
          tableId: (data.tableId as string | null | undefined) ?? null,
        } as ReservationRow;
        reservations.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        reservations.get(where.id) ?? null,
    },

    reservationAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;

  const audit = new AuditLogService(prisma);
  const tableAllocation = { allocate: vi.fn() } as unknown as TableAllocationService;
  const service = new WaitingListService(prisma, tableAllocation, audit);

  return { prisma, entries, reservations, audits, tableAllocation, service };
}

describe('waiting-list.service', () => {
  let fakes: ReturnType<typeof makeFakes>;

  beforeEach(() => {
    fakes = makeFakes();
    vi.clearAllMocks();
  });

  const baseArgs = {
    restaurantId: 'rest-1',
    partySize: 4,
    customerFirstName: 'Alice',
    customerLastName: 'Doe',
    customerPhone: '06 12 34 56 78',
    customerEmail: 'alice@example.com',
    source: 'web',
    waitingListEnabled: true,
    waitingListMaxEntriesPerSlot: 5,
  } as const;

  const futureSlot = () => new Date(Date.now() + 60 * 60 * 1000);

  describe('join', () => {
    it('creates a pending entry, computes position and returns an action token', async () => {
      const slotStart = futureSlot();
      const { entry, actionToken } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      expect(entry.status).toBe('PENDING');
      expect(entry.position).toBe(1);
      expect(entry.source).toBe('web');
      expect(entry.expiresAt.getTime()).toBe(slotStart.getTime());
      expect(actionToken).toBeTruthy();
      expect(fakes.entries.size).toBe(1);
      expect(scheduleWaitingListExpiration).toHaveBeenCalledWith({
        entryId: entry.id,
        expiresAt: entry.expiresAt,
      });
    });

    it('refuses when waitingListEnabled is false', async () => {
      await expect(
        fakes.service.join({
          ...baseArgs,
          slotStart: futureSlot(),
          waitingListEnabled: false,
        }),
      ).rejects.toThrow(WaitingListDisabledError);
    });

    it('refuses when the slot is full', async () => {
      const slotStart = futureSlot();
      const max = 2;

      for (let i = 0; i < max; i++) {
        await fakes.service.join({
          ...baseArgs,
          customerPhone: `06${i}12345678`,
          slotStart,
          waitingListMaxEntriesPerSlot: max,
        });
      }

      await expect(
        fakes.service.join({
          ...baseArgs,
          customerPhone: '0611111111',
          slotStart,
          waitingListMaxEntriesPerSlot: max,
        }),
      ).rejects.toThrow(WaitingListSlotFullError);
    });

    it('rejects a duplicate phone for the same slot', async () => {
      const slotStart = futureSlot();
      await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      await expect(
        fakes.service.join({
          ...baseArgs,
          slotStart,
        }),
      ).rejects.toThrow(WaitingListAlreadyExistsError);
    });
  });

  describe('cancelByToken', () => {
    it('cancels a pending entry by token', async () => {
      const slotStart = futureSlot();
      const { entry, actionToken } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      const cancelled = await fakes.service.cancelByToken({
        entryId: entry.id,
        actionToken,
        restaurantId: baseArgs.restaurantId,
      });

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelledAt).not.toBeNull();
    });

    it('is idempotent for already cancelled entries', async () => {
      const slotStart = futureSlot();
      const { entry, actionToken } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      const first = await fakes.service.cancelByToken({
        entryId: entry.id,
        actionToken,
        restaurantId: baseArgs.restaurantId,
      });
      const second = await fakes.service.cancelByToken({
        entryId: entry.id,
        actionToken,
        restaurantId: baseArgs.restaurantId,
      });

      expect(second.status).toBe('CANCELLED');
      expect(second.id).toBe(first.id);
    });

    it('throws when token or entry is invalid', async () => {
      await expect(
        fakes.service.cancelByToken({
          entryId: 'unknown',
          actionToken: 'invalid',
          restaurantId: baseArgs.restaurantId,
        }),
      ).rejects.toThrow(WaitingListEntryNotFoundError);
    });
  });

  describe('cancelByStaff', () => {
    it('cancels a pending entry by staff', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      const cancelled = await fakes.service.cancelByStaff(entry.id, baseArgs.restaurantId);

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelledAt).not.toBeNull();
    });

    it('throws when entry does not belong to the restaurant', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      await expect(fakes.service.cancelByStaff(entry.id, 'other-restaurant')).rejects.toThrow(
        WaitingListEntryNotFoundError,
      );
    });
  });

  describe('promoteEntry', () => {
    it('creates a reservation and marks the entry as PROMOTED', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      fakes.tableAllocation.allocate = vi.fn().mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 4,
      });

      const reservation = await fakes.service.promoteEntry(entry.id);

      expect(reservation).not.toBeNull();
      expect(reservation!.state).toBe('CONFIRMED');
      expect(reservation!.status).toBe('CONFIRMED');
      expect(reservation!.tableId).toBe('table-1');

      const updated = fakes.entries.get(entry.id)!;
      expect(updated.status).toBe('PROMOTED');
      expect(updated.promotedReservationId).toBe(reservation!.id);
      expect(updated.promotedAt).not.toBeNull();
    });

    it('is idempotent and returns the existing reservation', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      fakes.tableAllocation.allocate = vi.fn().mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 4,
      });

      const first = await fakes.service.promoteEntry(entry.id);
      const second = await fakes.service.promoteEntry(entry.id);

      expect(second).not.toBeNull();
      expect(second!.id).toBe(first!.id);
    });

    it('returns null when no table fits', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      fakes.tableAllocation.allocate = vi.fn().mockResolvedValue(null);

      const reservation = await fakes.service.promoteEntry(entry.id);

      expect(reservation).toBeNull();
      expect(fakes.entries.get(entry.id)!.status).toBe('PENDING');
    });

    it('schedules a promotion notification after a successful promotion', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      fakes.tableAllocation.allocate = vi.fn().mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 4,
      });

      const reservation = await fakes.service.promoteEntry(entry.id);

      expect(reservation).not.toBeNull();
      expect(scheduleWaitingListPromotionNotification).toHaveBeenCalledWith({
        entryId: entry.id,
        reservationId: reservation!.id,
      });
    });

    it('does not schedule a promotion notification when no table fits', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      fakes.tableAllocation.allocate = vi.fn().mockResolvedValue(null);

      await fakes.service.promoteEntry(entry.id);

      expect(scheduleWaitingListPromotionNotification).not.toHaveBeenCalled();
    });

    it('schedules a promotion notification on each successful call (idempotent)', async () => {
      const slotStart = futureSlot();
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      fakes.tableAllocation.allocate = vi.fn().mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 4,
      });

      await fakes.service.promoteEntry(entry.id);
      await fakes.service.promoteEntry(entry.id);

      // promoteEntry calls the scheduler after each successful call; the queue-level jobId deduplication prevents duplicate notifications.
      expect(scheduleWaitingListPromotionNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('expireEntry', () => {
    it('expires a pending entry whose expiresAt is passed', async () => {
      const slotStart = new Date(Date.now() - 1000);
      const { entry } = await fakes.service.join({
        ...baseArgs,
        slotStart,
      });

      await fakes.service.expireEntry(entry.id);

      expect(fakes.entries.get(entry.id)!.status).toBe('EXPIRED');
    });
  });

  describe('cleanupExpired', () => {
    it('bulk-expires all pending entries with expiresAt <= now', async () => {
      const now = new Date();
      const pastSlot = new Date(now.getTime() - 60 * 1000);
      const futureSlot = new Date(now.getTime() + 60 * 60 * 1000);

      const { entry: pastEntry } = await fakes.service.join({
        ...baseArgs,
        slotStart: pastSlot,
      });
      const { entry: pastEntry2 } = await fakes.service.join({
        ...baseArgs,
        customerPhone: '0712345678',
        slotStart: pastSlot,
      });
      const { entry: futureEntry } = await fakes.service.join({
        ...baseArgs,
        customerPhone: '0912345678',
        slotStart: futureSlot,
      });

      const count = await fakes.service.cleanupExpired(now);

      expect(count).toBe(2);
      expect(fakes.entries.get(pastEntry.id)!.status).toBe('EXPIRED');
      expect(fakes.entries.get(pastEntry2.id)!.status).toBe('EXPIRED');
      expect(fakes.entries.get(futureEntry.id)!.status).toBe('PENDING');
    });
  });
});
