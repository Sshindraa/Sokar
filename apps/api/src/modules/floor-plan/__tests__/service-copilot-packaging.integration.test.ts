/** Controlled PostgreSQL proof, separate from the still-open live-service/voice pilot. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.unmock('@prisma/client');
vi.unmock('../../../shared/db/client');
import { PrismaClient } from '@prisma/client';
import { ServiceCopilotDelayImpactService } from '../service-copilot-delay-impact.service';
import {
  ServiceCopilotDelayRecoveryService,
  DelayRecoveryConflictError,
} from '../service-copilot-delay-recovery.service';
import {
  evaluateCapability,
  getEffectiveEntitlements,
} from '../../entitlements/entitlement.service';
import { db } from '../../../shared/db/client';
const enabled = process.env.AGENTIC_INT_TESTS === '1';
if (enabled) {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test'))
    throw new Error('Copilot fixtures require a disposable local test database');
}
const suite = enabled ? describe : describe.skip;
suite('copilote Pro — PostgreSQL contrôlé', () => {
  const prisma = new PrismaClient();
  const analysis = new ServiceCopilotDelayImpactService(prisma);
  const recovery = new ServiceCopilotDelayRecoveryService(prisma);
  const startsAt = new Date('2099-03-10T18:00:00Z');
  const endsAt = new Date('2099-03-10T20:00:00Z');
  async function fixture() {
    const restaurant = await prisma.restaurant.create({
      data: {
        name: '[TEST COPILOT] Restaurant',
        plan: 'PRO',
        managerPhone: '0000000000',
        managerEmail: 'copilot@example.invalid',
        phoneNumber: `copilot-${randomUUID()}`,
        openingHours: {},
        floorPlans: {
          create: {
            tables: {
              create: [
                { name: 'T4', capacity: 2 },
                { name: 'T12', capacity: 2 },
              ],
            },
          },
        },
      },
      include: { floorPlans: { include: { tables: true } } },
    });
    const original = restaurant.floorPlans[0].tables.find((t) => t.name === 'T4')!;
    const alternative = restaurant.floorPlans[0].tables.find((t) => t.name === 'T12')!;
    const reservation = await prisma.reservation.create({
      data: {
        restaurantId: restaurant.id,
        customerName: '[TEST COPILOT] Retard',
        partySize: 2,
        reservedAt: startsAt,
        startsAt,
        endsAt,
        tableId: original.id,
        state: 'CONFIRMED',
        source: 'service_copilot_smoke',
      },
    });
    const waiting = await prisma.waitingListEntry.create({
      data: {
        restaurantId: restaurant.id,
        customerFirstName: '[TEST COPILOT] Attente',
        customerPhone: '0000000000',
        customerPhoneNormalized: '0000000000',
        partySize: 2,
        slotStart: startsAt,
        slotEnd: endsAt,
        expiresAt: new Date('2099-03-11T00:00:00Z'),
        actionTokenHash: randomUUID(),
        source: 'service_copilot_smoke',
      },
    });
    return {
      restaurant,
      reservation,
      waiting,
      original,
      alternative,
      args: {
        restaurantId: restaurant.id,
        reservationId: reservation.id,
        delayMinutes: 25,
        alternativeTableId: alternative.id,
        waitingListEntryId: waiting.id,
        waitingListAcceptanceConfirmed: true,
        actor: 'test-manager',
        idempotencyKey: randomUUID(),
      },
    };
  }
  afterAll(async () => {
    await prisma.$disconnect();
    await db.$disconnect();
  });
  it('maintient les restaurants présents au déploiement, sans donner ce droit aux nouveaux', async () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        '../../packages/database/prisma/migrations/20261013220000_service_copilot_legacy_access/migration.sql',
      ),
      'utf8',
    );
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE copilot_legacy_probe (id text PRIMARY KEY) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe("INSERT INTO copilot_legacy_probe (id) VALUES ('existing')");
      for (const statement of sql
        .replace(/--[^\n]*/g, '')
        .replaceAll('"restaurants"', 'copilot_legacy_probe')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !['BEGIN', 'COMMIT'].includes(s)))
        await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe("INSERT INTO copilot_legacy_probe (id) VALUES ('new')");
      expect(
        await tx.$queryRaw`SELECT id, service_copilot_legacy_access AS allowed FROM copilot_legacy_probe ORDER BY id`,
      ).toEqual([
        { id: 'existing', allowed: true },
        { id: 'new', allowed: false },
      ]);
    });
    const f = await fixture();
    await prisma.restaurant.update({ where: { id: f.restaurant.id }, data: { plan: 'ESSENTIAL' } });
    expect((await evaluateCapability(f.restaurant.id, 'floorPlan.copilot')).allowed).toBe(false);
    await prisma.restaurant.update({
      where: { id: f.restaurant.id },
      data: { serviceCopilotLegacyAccess: true },
    });
    const rights = await getEffectiveEntitlements(f.restaurant.id);
    expect(rights.capabilities['floorPlan.copilot']).toBe(true);
    expect(rights.capabilities['marketing.campaigns']).toBe(false);
  });
  it('analyse sans écrire, exige l’acceptation puis applique et annule de façon idempotente', async () => {
    const f = await fixture();
    const proposal = await analysis.simulate(f.args);
    expect(proposal.feasible).toBe(true);
    expect(proposal.alternativeTable?.id).toBe(f.alternative.id);
    expect(proposal.waitingListEntry?.id).toBe(f.waiting.id);
    expect(await prisma.reservation.count({ where: { restaurantId: f.restaurant.id } })).toBe(1);
    expect(
      await prisma.reservationAuditLog.count({ where: { reservationId: f.reservation.id } }),
    ).toBe(0);
    await expect(
      recovery.apply({ ...f.args, waitingListAcceptanceConfirmed: false }),
    ).rejects.toBeInstanceOf(DelayRecoveryConflictError);
    const [first, second] = await Promise.all([recovery.apply(f.args), recovery.apply(f.args)]);
    expect(second.operationId).toBe(first.operationId);
    expect(second.promotedReservationId).toBe(first.promotedReservationId);
    expect([first, second].filter((result) => result.idempotent)).toHaveLength(1);
    expect(await prisma.reservation.count({ where: { restaurantId: f.restaurant.id } })).toBe(2);
    expect(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).tableId,
    ).toBe(f.alternative.id);
    const revertArgs = {
      restaurantId: f.restaurant.id,
      reservationId: f.reservation.id,
      operationId: first.operationId,
      actor: 'test-manager',
    };
    await recovery.revert(revertArgs);
    await recovery.revert(revertArgs);
    expect(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).tableId,
    ).toBe(f.original.id);
    expect(
      (await prisma.waitingListEntry.findUniqueOrThrow({ where: { id: f.waiting.id } })).status,
    ).toBe('PENDING');
    expect(
      await prisma.reservationAuditLog.count({
        where: { reservationId: f.reservation.id, event: 'reservation_delay_recovered' },
      }),
    ).toBe(1);
    expect(
      await prisma.reservationAuditLog.count({
        where: { reservationId: f.reservation.id, event: 'reservation_delay_recovery_reverted' },
      }),
    ).toBe(1);
  });
  it('refuse un conflit apparu depuis la proposition, sans mutation partielle', async () => {
    const f = await fixture();
    expect((await analysis.simulate(f.args)).feasible).toBe(true);
    await prisma.reservation.create({
      data: {
        restaurantId: f.restaurant.id,
        customerName: '[TEST COPILOT] Conflit',
        partySize: 2,
        reservedAt: startsAt,
        startsAt,
        endsAt: new Date('2099-03-10T21:00:00Z'),
        tableId: f.alternative.id,
        state: 'CONFIRMED',
      },
    });
    await expect(recovery.apply(f.args)).rejects.toBeInstanceOf(DelayRecoveryConflictError);
    expect(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).tableId,
    ).toBe(f.original.id);
    expect(
      (await prisma.waitingListEntry.findUniqueOrThrow({ where: { id: f.waiting.id } })).status,
    ).toBe('PENDING');
  });
  it('refuse le retour arrière après installation et refuse une réservation d’un autre restaurant', async () => {
    const f = await fixture();
    expect(
      (await analysis.simulate({ ...f.args, restaurantId: `other-${randomUUID()}` })).feasible,
    ).toBe(false);
    const result = await recovery.apply(f.args);
    await prisma.reservation.update({
      where: { id: result.promotedReservationId },
      data: { state: 'SEATED', status: 'CONFIRMED' },
    });
    await expect(
      recovery.revert({
        restaurantId: f.restaurant.id,
        reservationId: f.reservation.id,
        operationId: result.operationId,
        actor: 'test-manager',
      }),
    ).rejects.toBeInstanceOf(DelayRecoveryConflictError);
    expect(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).tableId,
    ).toBe(f.alternative.id);
  });
});
