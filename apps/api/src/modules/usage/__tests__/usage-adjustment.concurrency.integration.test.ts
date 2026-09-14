/**
 * PostgreSQL-only proof for the adjustment queue.
 *
 * The suite is skipped during the normal unit run and joins the existing
 * `AGENTIC_INT_TESTS=1` integration profile. It requires the additive usage
 * migrations and a disposable local database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.unmock('@prisma/client');

import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient, UsageAdjustmentStatus } from '@prisma/client';
import {
  UsageAdjustmentStateError,
  decideUsageAdjustment,
  recordUsageAdjustment,
} from '../usage-adjustment.service';

const runIntegration = process.env.AGENTIC_INT_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;
const prisma = new PrismaClient();

let restaurantId: string;

function reportHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function adjustmentInput(seed: string) {
  return {
    reportHash: reportHash(seed),
    evidenceRef: `vault://integration/${seed}.json`,
    scopeKey: `restaurant:${restaurantId}`,
    restaurantId,
    category: 'SMS_SEGMENTS' as const,
    provider: 'telnyx',
    unit: 'segments',
    periodStart: new Date('2099-09-01T00:00:00.000Z'),
    periodEnd: new Date('2099-10-01T00:00:00.000Z'),
    quantityDelta: '-2',
    costDeltaEur: '0.015',
    reason: 'Concurrent integration fixture.',
    createdByHash: reportHash(`${seed}:creator`),
  };
}

describeIntegration('usage adjustments — PostgreSQL concurrency', () => {
  beforeAll(async () => {
    restaurantId = `usage-adjustment-${randomUUID()}`;
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        name: 'Usage adjustment integration',
        slug: restaurantId,
        managerPhone: '+33600000000',
        managerEmail: 'usage-adjustment@example.com',
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
    await prisma.usageReconciliationAdjustment.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.delete({ where: { id: restaurantId } });
    await prisma.$disconnect();
  });

  it('allows one insert and returns idempotent replays under concurrency', async () => {
    const input = adjustmentInput('same-report');
    const results = await Promise.all(
      Array.from({ length: 32 }, () => recordUsageAdjustment(input, prisma)),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(31);
    expect(
      await prisma.usageReconciliationAdjustment.count({ where: { reportHash: input.reportHash } }),
    ).toBe(1);
  });

  it('lets exactly one of two concurrent decisions win', async () => {
    const created = await recordUsageAdjustment(adjustmentInput('decision-race'), prisma);
    const decisions = await Promise.allSettled([
      decideUsageAdjustment(
        {
          id: created.adjustment.id,
          status: UsageAdjustmentStatus.APPROVED,
          reason: 'Approved race winner.',
          decidedByHash: reportHash('approver-a'),
        },
        prisma,
      ),
      decideUsageAdjustment(
        {
          id: created.adjustment.id,
          status: UsageAdjustmentStatus.REJECTED,
          reason: 'Rejected race loser.',
          decidedByHash: reportHash('approver-b'),
        },
        prisma,
      ),
    ]);

    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = decisions.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(
      UsageAdjustmentStateError,
    );
    const row = await prisma.usageReconciliationAdjustment.findUnique({
      where: { id: created.adjustment.id },
    });
    expect([UsageAdjustmentStatus.APPROVED, UsageAdjustmentStatus.REJECTED]).toContain(row?.status);
  });
});
