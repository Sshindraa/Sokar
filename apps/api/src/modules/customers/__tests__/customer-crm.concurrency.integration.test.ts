/**
 * PostgreSQL-only proof for the CRM release gate P2_CRM (docs/release/product-gates.json):
 * merge, segmentation and metric projection under concurrent calls.
 *
 * Skipped during the normal unit run; part of the `AGENTIC_INT_TESTS=1` integration profile
 * (CI job « API integration (Postgres) »). Requires a disposable database with the migrations.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.unmock('@prisma/client');

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { mergeCustomerProfiles } from '../customer-merge.service';
import { ensureSystemCustomerSegments, previewCustomerSegment } from '../customer-segment.service';
import { rebuildCustomerMetricSnapshot } from '../customer-crm.service';
import { ReservationLifecycleService } from '../../reservations/reservation-lifecycle.service';

const runIntegration = process.env.AGENTIC_INT_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;
const prisma = new PrismaClient();

let restaurantId: string;
let phoneSeq = 0;

async function createCustomer(name: string) {
  phoneSeq += 1;
  return prisma.customer.create({
    data: {
      restaurantId,
      phone: `+3361${String(Date.now()).slice(-5)}${String(phoneSeq).padStart(3, '0')}`,
      name,
    },
  });
}

async function createHonouredReservation(customerId: string, daysAgo: number, partySize = 2) {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return prisma.reservation.create({
    data: {
      restaurantId,
      customerId,
      customerName: 'Fixture',
      partySize,
      reservedAt: date,
      startsAt: date,
      status: 'SEATED',
      state: 'HONORED',
    },
  });
}

describeIntegration('CRM — PostgreSQL concurrency (P2_CRM)', () => {
  beforeAll(async () => {
    restaurantId = `crm-concurrency-${randomUUID()}`;
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        name: 'CRM concurrency integration',
        slug: restaurantId,
        managerPhone: '+33600000000',
        managerEmail: 'crm-concurrency@example.com',
        phoneNumber: `+331${Date.now().toString().slice(-8)}`,
        openingHours: {
          monday: { open: '00:00', close: '23:59' },
          tuesday: { open: '00:00', close: '23:59' },
          wednesday: { open: '00:00', close: '23:59' },
          thursday: { open: '00:00', close: '23:59' },
          friday: { open: '00:00', close: '23:59' },
          saturday: { open: '00:00', close: '23:59' },
          sunday: { open: '00:00', close: '23:59' },
        },
      },
    });
  });

  afterAll(async () => {
    if (!runIntegration) return;
    // Cascades remove CRM rows; reservations and audits are scoped to this fixture restaurant.
    await prisma.customerMergeAudit.deleteMany({ where: { restaurantId } });
    await prisma.reservation.deleteMany({ where: { restaurantId } });
    await prisma.customerMetricSnapshot.deleteMany({ where: { restaurantId } });
    await prisma.customerSegment.deleteMany({ where: { restaurantId } });
    await prisma.customer.updateMany({ where: { restaurantId }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.delete({ where: { id: restaurantId } });
    await prisma.$disconnect();
  });

  it('invalidates both customer revisions transactionally when a reservation changes', async () => {
    const first = await createCustomer('Profil cache A');
    const second = await createCustomer('Profil cache B');
    const reservation = await createHonouredReservation(first.id, 10);
    const revision = async (customerId: string) =>
      (await prisma.customerVisitCacheRevision.findUnique({ where: { customerId } }))?.version ??
      0n;
    const firstCreated = await revision(first.id);
    expect(firstCreated).toBeGreaterThan(0n);
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { customerName: 'Modifié' },
    });
    expect(await revision(first.id)).toBe(firstCreated);
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { customerId: second.id },
    });
    expect(await revision(first.id)).toBeGreaterThan(firstCreated);
    const secondAssigned = await revision(second.id);
    expect(secondAssigned).toBeGreaterThan(0n);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.reservation.update({ where: { id: reservation.id }, data: { state: 'NO_SHOW' } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await revision(second.id)).toBe(secondAssigned);
    await prisma.reservation.update({ where: { id: reservation.id }, data: { state: 'NO_SHOW' } });
    const secondChanged = await revision(second.id);
    expect(secondChanged).toBeGreaterThan(secondAssigned);
    await prisma.reservation.delete({ where: { id: reservation.id } });
    expect(await revision(second.id)).toBeGreaterThan(secondChanged);
    await createHonouredReservation(second.id, 2);
    const beforeDelete = await revision(second.id);
    await prisma.customer.delete({ where: { id: second.id } });
    expect(await revision(second.id)).toBe(0n);
    await prisma.customer.create({
      data: { id: second.id, restaurantId, phone: second.phone },
    });
    await createHonouredReservation(second.id, 3);
    expect(await revision(second.id)).toBeGreaterThan(beforeDelete);
  });

  it('invalidates only the non-test sides when reservations enter or leave the CRM scope', async () => {
    const a = await createCustomer('Scope A');
    const b = await createCustomer('Scope B');
    const date = new Date('2026-01-01T12:00:00Z');
    const revision = async (customerId: string) =>
      (await prisma.customerVisitCacheRevision.findUnique({ where: { customerId } }))?.version ??
      0n;
    const reservation = await prisma.reservation.create({
      data: {
        restaurantId,
        customerId: a.id,
        customerName: 'Test',
        partySize: 2,
        reservedAt: date,
        isTest: true,
      },
    });
    expect(await revision(a.id)).toBe(0n);
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { customerId: b.id, state: 'NO_SHOW' },
    });
    expect(await revision(a.id)).toBe(0n);
    expect(await revision(b.id)).toBe(0n);
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { isTest: false, customerId: a.id },
    });
    const realA = await revision(a.id);
    expect(realA).toBeGreaterThan(0n);
    expect(await revision(b.id)).toBe(0n);
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { isTest: true, customerId: b.id },
    });
    expect(await revision(a.id)).toBeGreaterThan(realA);
    expect(await revision(b.id)).toBe(0n);
    const after = await revision(a.id);
    await prisma.reservation.delete({ where: { id: reservation.id } });
    expect(await revision(a.id)).toBe(after);
    expect(await revision(b.id)).toBe(0n);
  });

  it('measures concurrent real lifecycle transactions for one or distinct customers', async () => {
    const lifecycle = new ReservationLifecycleService(prisma);
    // Audits are append-only; this tenant lives only in the disposable integration database.
    const benchRestaurantId = `crm-contention-${randomUUID()}`;
    await prisma.restaurant.create({
      data: {
        id: benchRestaurantId,
        name: 'CRM contention',
        slug: benchRestaurantId,
        managerPhone: 'test',
        managerEmail: 'test@example.invalid',
        phoneNumber: benchRestaurantId,
        openingHours: {},
      },
    });
    const customer = (index: number) =>
      prisma.customer.create({
        data: { restaurantId: benchRestaurantId, phone: `bench-${index}`, name: 'Test' },
      });
    const same = await customer(0);
    const distinct = await Promise.all(
      Array.from({ length: 8 }, (_, index) => customer(index + 1)),
    );
    const run = async (customers: string[], confirm = false) => {
      const reservations = await Promise.all(
        customers.map((customerId) =>
          prisma.reservation.create({
            data: {
              restaurantId: benchRestaurantId,
              customerId,
              customerName: 'Test',
              partySize: 2,
              reservedAt: new Date('2026-01-01T12:00:00Z'),
              state: confirm ? 'PENDING' : 'CONFIRMED',
              status: 'CONFIRMED',
              ...(confirm ? { channel: 'WEB', customerEmail: 'test@example.invalid' } : {}),
            },
          }),
        ),
      );
      const durations: number[] = [];
      let maxWaiters = 0;
      let samples = 0;
      let polling = false;
      let pollError: unknown;
      const timer = setInterval(() => {
        if (polling) return;
        polling = true;
        prisma.$queryRaw<
          Array<{ waiters: number }>
        >`SELECT count(*)::int AS waiters FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state='active'`
          .then((rows) => {
            samples++;
            maxWaiters = Math.max(maxWaiters, rows[0].waiters);
          })
          .catch((error: unknown) => {
            pollError = error;
          })
          .finally(() => {
            polling = false;
          });
      }, 2);
      try {
        await Promise.all(
          reservations.map(async (reservation) => {
            const args = {
              reservationId: reservation.id,
              restaurantId: benchRestaurantId,
              toState: confirm ? ('CONFIRMED' as const) : ('NO_SHOW' as const),
              actor: 'test:contention',
              ...(confirm ? { auditEvent: 'reservation_confirmed' } : {}),
            };
            const start = performance.now();
            const result = await prisma.$transaction((tx) =>
              lifecycle.transitionInTransaction(tx, args),
            );
            durations.push(performance.now() - start);
            await lifecycle.finalizeTransition(args, result);
          }),
        );
      } finally {
        clearInterval(timer);
      }
      if (pollError) throw pollError;
      expect(
        await prisma.reservationAuditLog.count({
          where: {
            reservationId: { in: reservations.map((r) => r.id) },
            event: confirm ? 'reservation_confirmed' : 'reservation_no_show',
          },
        }),
      ).toBe(8);
      if (confirm) {
        expect(
          await prisma.outboxEvent.count({
            where: {
              aggregateId: { in: reservations.map((r) => r.id) },
              topic: 'reservation-confirmation-email',
            },
          }),
        ).toBe(8);
      }
      durations.sort((a, b) => a - b);
      return {
        minMs: +durations[0].toFixed(1),
        maxMs: +durations[7].toFixed(1),
        maxWaiters,
        samples,
      };
    };
    const sameCustomer = await run(Array(8).fill(same.id));
    const distinctCustomers = await run(distinct.map((customer) => customer.id));
    const sameCustomerWithOutbox = await run(Array(8).fill(same.id), true);
    const distinctCustomersWithOutbox = await run(
      distinct.map((customer) => customer.id),
      true,
    );
    console.info(
      'lifecycle contention',
      JSON.stringify({
        sameCustomer,
        distinctCustomers,
        sameCustomerWithOutbox,
        distinctCustomersWithOutbox,
      }),
    );
  });

  it('a merge replayed concurrently with one idempotency key runs once', async () => {
    const target = await createCustomer('Cible');
    const source = await createCustomer('Doublon');
    await createHonouredReservation(source.id, 10);
    const idempotencyKey = `merge-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        mergeCustomerProfiles({
          restaurantId,
          targetCustomerId: target.id,
          sourceCustomerIds: [source.id],
          idempotencyKey,
        }),
      ),
    );

    expect(new Set(results.map((result) => result.auditId)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await prisma.customerMergeAudit.count({ where: { restaurantId, idempotencyKey } })).toBe(
      1,
    );
    const merged = await prisma.customer.findUniqueOrThrow({ where: { id: source.id } });
    expect(merged.mergedIntoId).toBe(target.id);
    expect(merged.archivedAt).not.toBeNull();
    expect(await prisma.reservation.count({ where: { restaurantId, customerId: target.id } })).toBe(
      1,
    );
  });

  it('two crossing merges (A ← B and B ← A) never leave both profiles merged into each other', async () => {
    const a = await createCustomer('Profil A');
    const b = await createCustomer('Profil B');

    const outcomes = await Promise.allSettled([
      mergeCustomerProfiles({
        restaurantId,
        targetCustomerId: a.id,
        sourceCustomerIds: [b.id],
        idempotencyKey: `cross-a-${randomUUID()}`,
      }),
      mergeCustomerProfiles({
        restaurantId,
        targetCustomerId: b.id,
        sourceCustomerIds: [a.id],
        idempotencyKey: `cross-b-${randomUUID()}`,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [rowA, rowB] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.customer.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    const active = [rowA, rowB].filter((row) => row.mergedIntoId === null && !row.archivedAt);
    expect(active).toHaveLength(1);
    const archived = [rowA, rowB].find((row) => row.mergedIntoId !== null);
    expect(archived?.mergedIntoId).toBe(active[0].id);
  });

  it('concurrent metric projections converge on one snapshot with the real visit count', async () => {
    const customer = await createCustomer('Habitué');
    await createHonouredReservation(customer.id, 5);
    await createHonouredReservation(customer.id, 40);
    await createHonouredReservation(customer.id, 200);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        rebuildCustomerMetricSnapshot({ restaurantId, customerId: customer.id, now: new Date() }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(0);
    const snapshots = await prisma.customerMetricSnapshot.findMany({
      where: { customerId: customer.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].honored365d).toBe(3);
    expect(snapshots[0].honored30d).toBe(1);
    expect(snapshots[0].projectionVersion).toBeGreaterThanOrEqual(1);
  });

  it('system segments initialized from concurrent tabs exist once and never count merged profiles', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => ensureSystemCustomerSegments({ restaurantId })),
    );

    const segments = await prisma.customerSegment.findMany({
      where: { restaurantId, isSystem: true },
      select: { systemKey: true },
    });
    expect(segments.length).toBeGreaterThan(0);
    expect(new Set(segments.map((segment) => segment.systemKey)).size).toBe(segments.length);

    // Deux VIP, dont l'un est fusionné dans l'autre en même temps qu'on évalue le segment.
    const keep = await createCustomer('VIP gardé');
    const duplicate = await createCustomer('VIP doublon');
    await prisma.customer.updateMany({
      where: { id: { in: [keep.id, duplicate.id] } },
      data: { isVip: true },
    });
    const vipDefinition = {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'isVip', op: 'EQ', value: true }],
    };
    const [, during] = await Promise.all([
      mergeCustomerProfiles({
        restaurantId,
        targetCustomerId: keep.id,
        sourceCustomerIds: [duplicate.id],
        idempotencyKey: `vip-${randomUUID()}`,
      }),
      previewCustomerSegment({ restaurantId, definition: vipDefinition }),
    ]);
    // Pendant la fusion : l'état d'avant ou d'après, jamais un profil compté deux fois ou perdu.
    expect([1, 2]).toContain(during.count);
    const after = await previewCustomerSegment({ restaurantId, definition: vipDefinition });
    expect(after.count).toBe(1);
    expect(after.sample.map((row) => row.id)).toEqual([keep.id]);
  });
});
