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
