import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { purgeMarketingRetention } from '../marketing-retention-purge';

const NOW = new Date('2026-10-28T03:20:00Z');

function yearsAgo(years: number): Date {
  const date = new Date(NOW);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

/**
 * Base en mémoire juste assez fidèle pour le parcours de la purge :
 * - p-old : aucun contact depuis 4 ans, fichier à supprimer ;
 * - p-booked : réservation il y a 1 an, fichier gardé ;
 * - p-acted : le client a agi sur son consentement il y a 2 ans, fichier gardé ;
 * - w-old : retirée il y a 6 ans, preuve à supprimer ; w-recent : retirée il y a 4 ans, gardée.
 */
function fakeDb() {
  let prospects = [
    {
      id: 'p-acted',
      customerId: 'c-acted',
      channel: 'EMAIL',
      consentedAt: yearsAgo(4),
      createdAt: yearsAgo(4),
    },
    {
      id: 'p-booked',
      customerId: 'c-booked',
      channel: 'EMAIL',
      consentedAt: yearsAgo(4),
      createdAt: yearsAgo(4),
    },
    {
      id: 'p-old',
      customerId: 'c-old',
      channel: 'EMAIL',
      consentedAt: yearsAgo(4),
      createdAt: yearsAgo(4),
    },
  ];
  let withdrawn = [
    { id: 'w-old', withdrawnAt: yearsAgo(6) },
    { id: 'w-recent', withdrawnAt: yearsAgo(4) },
  ];
  const lastReservation: Record<string, Date> = { 'c-booked': yearsAgo(1) };
  const lastOwnAct: Record<string, Date> = { 'c-acted': yearsAgo(2) };

  const db = {
    marketingPermission: {
      findMany: vi.fn(
        async (args: {
          where: { status: unknown; withdrawnAt?: { lt: Date } };
          cursor?: unknown;
        }) => {
          if (args.where.status && typeof args.where.status === 'object') {
            return args.cursor ? [] : prospects;
          }
          const cutoff = args.where.withdrawnAt?.lt.getTime() ?? 0;
          return withdrawn.filter((row) => row.withdrawnAt.getTime() < cutoff);
        },
      ),
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        const ids = args.where.id.in;
        const before = prospects.length + withdrawn.length;
        prospects = prospects.filter((row) => !ids.includes(row.id));
        withdrawn = withdrawn.filter((row) => !ids.includes(row.id));
        return { count: before - prospects.length - withdrawn.length };
      }),
    },
    marketingPermissionEvent: {
      aggregate: vi.fn(async (args: { where: { customerId: string } }) => ({
        _max: { occurredAt: lastOwnAct[args.where.customerId] ?? null },
      })),
      deleteMany: vi.fn(async (args: { where: { permissionId: unknown } }) => ({
        count: args.where.permissionId === null ? 2 : 1,
      })),
    },
    reservation: {
      aggregate: vi.fn(async (args: { where: { customerId: string } }) => ({
        _max: { createdAt: lastReservation[args.where.customerId] ?? null },
      })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

describe('purgeMarketingRetention', () => {
  it('supprime le fichier de prospection inactif depuis 3 ans, et garde les autres', async () => {
    const db = fakeDb();

    const result = await purgeMarketingRetention(db as unknown as PrismaClient, NOW);

    expect(db.marketingPermission.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['p-old'] } },
    });
    expect(result.prospectFiles).toBe(1);
  });

  it('supprime la preuve d’une permission retirée depuis plus de 5 ans, et garde les autres', async () => {
    const db = fakeDb();

    const result = await purgeMarketingRetention(db as unknown as PrismaClient, NOW);

    expect(db.marketingPermissionEvent.deleteMany).toHaveBeenCalledWith({
      where: { permissionId: { in: ['w-old'] } },
    });
    expect(db.marketingPermission.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['w-old'] }, status: 'OPTED_OUT' },
    });
    expect(result.withdrawnPermissions).toBe(1);
  });

  it('supprime les preuves orphelines 5 ans après leur dernier événement', async () => {
    const db = fakeDb();

    const result = await purgeMarketingRetention(db as unknown as PrismaClient, NOW);

    expect(db.marketingPermissionEvent.deleteMany).toHaveBeenCalledWith({
      where: { permissionId: null, occurredAt: { lt: yearsAgo(5) } },
    });
    expect(result.orphanEvents).toBe(2);
  });
});
