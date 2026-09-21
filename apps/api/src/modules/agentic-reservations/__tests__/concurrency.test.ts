/**
 * Tests de concurrence et de fallback Redis down.
 *
 * Tourne contre la vraie DB locale Postgres (DATABASE_URL dans
 * packages/database/.env). Ces tests sont marqués `integration` et
 * exclus par défaut ; ils sont exécutés par le script `pnpm test:int`.
 *
 * Pré-requis : avoir appliqué les migrations Phase 0 et créé un
 * restaurant de test.
 *
 * Le mock Prisma global (src/test/setup.ts) est bypass via vi.unmock
 * pour avoir accès aux vraies tables idempotency_records, agentic_holds,
 * reservation_audit_log, etc.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.unmock('@prisma/client');

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { HoldConflictError, HoldService } from '../core/hold.service.js';
import { AuditLogService } from '../core/audit-log.service.js';
import { buildPolicySnapshot } from '../core/policies.service.js';
import { PrismaIdempotencyStore } from '../core/prisma-store.js';
import {
  IdempotencyService,
  computeIdempotencyScope,
  hashPayload,
} from '../core/idempotency.service.js';
import {
  ReservationService,
  ReservationSlotUnavailableError,
} from '../core/reservation.service.js';
import { ReservationService as LegacyReservationService } from '../../reservations/reservation.service';
import {
  compareReservationContractResults,
  normalizeReservationContractResult,
} from '../../reservations/contract-shadow-harness';
import {
  creationProjection,
  isConfirmedReservation,
  isReservationState,
  type CreatableReservationState,
} from '../../../shared/reservations/reservation-state';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service.js';
import { TableAllocationService } from '../../floor-plan/table-allocation.service.js';

const prisma = new PrismaClient();
const audit = new AuditLogService(prisma);
const holds = new HoldService(prisma, audit);
const idemStore = new PrismaIdempotencyStore(prisma);
const idem = new IdempotencyService(idemStore);
const runIntegration = process.env.AGENTIC_INT_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

let testRestaurantId: string;
let testFloorPlanId: string;
let testTableId: string;

const policy = buildPolicySnapshot({
  policyVersion: '2026-06-20',
  maxPartySize: 12,
  minLeadTimeMinutes: 30,
  requireManualValidation: false,
  quoteTtlSeconds: 300,
  holdTtlSeconds: 420,
  noShowPolicy: 'warning',
  notificationChannels: ['sms'],
  capacitySpecials: {},
});

const ACTIVE_RESERVATION_STATES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;
type ActiveReservationState = (typeof ACTIVE_RESERVATION_STATES)[number];

/** Même grille que `policy`, avec la validation manuelle activée. */
const manualValidationPolicy = buildPolicySnapshot({
  policyVersion: '2026-06-20',
  maxPartySize: 12,
  minLeadTimeMinutes: 30,
  requireManualValidation: true,
  quoteTtlSeconds: 300,
  holdTtlSeconds: 420,
  noShowPolicy: 'warning',
  notificationChannels: ['sms'],
  capacitySpecials: {},
});

/** Numéros déterministes et uniques par exécution (pas de collision intra-run). */
let parityPhoneOffset = 0;

function parityPhone(): string {
  parityPhoneOffset += 1;
  return `+3360000${String(parityPhoneOffset).padStart(4, '0')}`;
}

function parityIdempotency(seed: string) {
  return {
    scope: `${testRestaurantId}:parity:${seed}`,
    key: `parity-${seed}`,
    payloadHash: hashPayload({ seed }),
    ttlSeconds: 60,
  };
}

let capacitySlotOffset = 0;

function nextCapacitySlot(): { date: string; startsAt: Date; endsAt: Date } {
  const startsAt = new Date(Date.UTC(2099, 5, 5 + capacitySlotOffset, 17, 0, 0));
  capacitySlotOffset += 1;
  return {
    date: startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
  };
}

async function createCapacityReservation(args: {
  state: ActiveReservationState;
  tableId: string | null;
  startsAt: Date;
  endsAt: Date;
}): Promise<string> {
  const id = `capacity-reservation-${randomUUID()}`;
  await prisma.reservation.create({
    data: {
      id,
      restaurantId: testRestaurantId,
      reservedAt: args.startsAt,
      partySize: 4,
      customerName: 'Capacity test',
      customerPhone: '+33600000000',
      channel: 'MCP',
      state: args.state,
      status: args.state === 'SEATED' ? 'SEATED' : 'CONFIRMED',
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      createdByClient: 'test:capacity',
      consents: {},
      privacyPolicyVersion: '2026-06-20',
      tableId: args.tableId,
    },
  });
  return id;
}

async function createCapacityHold(args: {
  tableId: string | null;
  startsAt: Date;
  endsAt: Date;
}): Promise<string> {
  const id = `capacity-hold-${randomUUID()}`;
  await prisma.agenticHold.create({
    data: {
      id,
      restaurantId: testRestaurantId,
      type: 'HOLD',
      partySize: 4,
      slotStart: args.startsAt,
      slotEnd: args.endsAt,
      channel: 'MCP',
      holdToken: `capacity-token-${randomUUID()}`,
      expiresAt: new Date(args.endsAt.getTime() + 10 * 60 * 1000),
      status: 'ACTIVE',
      policyVersion: '2026-06-20',
      tableId: args.tableId,
    },
  });
  return id;
}

async function slotAvailability(
  service: CapacityAwareAvailabilityService,
  date: string,
): Promise<boolean> {
  const result = await service.getAvailability({
    restaurantId: testRestaurantId,
    date,
    partySize: 4,
  });
  const slot = result.slots.find((candidate) => candidate.time === '19:00');
  expect(slot).toBeDefined();
  return slot?.available ?? false;
}

beforeAll(async () => {
  if (!runIntegration) return;
  // Chaque exécution utilise des identifiants uniques. La fixture peut donc
  // tourner plusieurs fois sur la même base sans tenter de supprimer des
  // réservations référencées par l'audit append-only.
  testRestaurantId = `resto-test-concurrency-${randomUUID()}`;
  testFloorPlanId = `floor-plan-test-concurrency-${randomUUID()}`;
  testTableId = `table-test-concurrency-${randomUUID()}`;
  const testPhoneNumber = `+331${Date.now().toString().slice(-8)}`;

  const r = await prisma.restaurant.create({
    data: {
      id: testRestaurantId,
      name: 'Resto Test Concurrency',
      slug: testRestaurantId,
      managerPhone: '+33600000000',
      managerEmail: 'test@example.com',
      phoneNumber: testPhoneNumber,
      openingHours: {
        monday: { open: '00:00', close: '23:59' },
        tuesday: { open: '00:00', close: '23:59' },
        wednesday: { open: '00:00', close: '23:59' },
        thursday: { open: '00:00', close: '23:59' },
        friday: { open: '00:00', close: '23:59' },
        saturday: { open: '00:00', close: '23:59' },
        sunday: { open: '00:00', close: '23:59' },
      },
      agenticOptIn: true,
    },
  });
  testRestaurantId = r.id;

  const floorPlan = await prisma.floorPlan.create({
    data: {
      id: testFloorPlanId,
      restaurantId: testRestaurantId,
      name: 'Plan de test concurrence',
      isDefault: true,
      isActive: true,
    },
  });
  testFloorPlanId = floorPlan.id;

  const table = await prisma.table.create({
    data: {
      id: testTableId,
      floorPlanId: testFloorPlanId,
      name: 'Table test concurrence',
      capacity: 12,
      minCapacity: 1,
      isActive: true,
    },
  });
  expect(table.id).toBe(testTableId);
});

afterAll(async () => {
  if (!runIntegration) return;
  // Les audits sont append-only et empêchent la suppression des réservations
  // qui leur sont liées. Les identifiants uniques isolent la fixture ; la CI
  // détruit la base éphémère en fin de job (et le runbook local supprime le
  // conteneur dédié après validation).
  await prisma.$disconnect();
});

describeIntegration('concurrency — partial unique index enforcement', () => {
  it('1000 req simultanées sur le même slot → 1 seul hold, 999 conflits', async () => {
    const slotStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 90 * 60 * 1000);

    // Cleanup avant test
    await prisma.agenticHold.deleteMany({
      where: {
        restaurantId: testRestaurantId,
        slotStart,
        type: 'HOLD',
      },
    });

    const promises = Array.from({ length: 1000 }, () =>
      holds
        .createHold({
          restaurantId: testRestaurantId,
          partySize: 4,
          slotStart,
          slotEnd,
          channel: 'MCP',
          policy,
          actor: 'agent:concurrency-test',
        })
        .then(() => 'ok' as const)
        .catch((err) => {
          if (err instanceof HoldConflictError) return 'conflict' as const;
          throw err;
        }),
    );

    const results = await Promise.all(promises);
    const oks = results.filter((r) => r === 'ok').length;
    const conflicts = results.filter((r) => r === 'conflict').length;

    expect(oks).toBe(1);
    expect(conflicts).toBe(999);
    expect(oks + conflicts).toBe(1000);

    // Vérifie qu'il n'y a bien qu'un seul hold ACTIVE en DB
    const activeCount = await prisma.agenticHold.count({
      where: {
        restaurantId: testRestaurantId,
        slotStart,
        type: 'HOLD',
        status: 'ACTIVE',
      },
    });
    expect(activeCount).toBe(1);
  }, 30_000);

  it('après expiration du premier hold, un nouveau hold peut être créé', async () => {
    const slotStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 90 * 60 * 1000);

    await prisma.agenticHold.deleteMany({
      where: { restaurantId: testRestaurantId, slotStart, type: 'HOLD' },
    });

    const h1 = await holds.createHold({
      restaurantId: testRestaurantId,
      partySize: 2,
      slotStart,
      slotEnd,
      channel: 'MCP',
      policy,
      actor: 'agent:test1',
    });
    expect(h1.status).toBe('ACTIVE');

    // Force expiration
    await prisma.agenticHold.update({
      where: { id: h1.id },
      data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) },
    });

    // Nouveau hold doit passer
    const h2 = await holds.createHold({
      restaurantId: testRestaurantId,
      partySize: 2,
      slotStart,
      slotEnd,
      channel: 'MCP',
      policy,
      actor: 'agent:test2',
    });
    expect(h2.status).toBe('ACTIVE');
    expect(h2.id).not.toBe(h1.id);
  });
});

describeIntegration('idempotency — partial unique index on (scope, key)', () => {
  it('mêmes scope+key : 1 seule résa créée, N renvoient le même résultat', async () => {
    const scope = computeIdempotencyScope({
      restaurantId: testRestaurantId,
      channel: 'MCP',
      clientId: 'concurrency-test',
    });
    const key = 'idem-test-key-1';
    const payload = { partySize: 4, startsAt: '2026-12-01T19:00:00Z' };
    const payloadHash = hashPayload(payload);

    // Cleanup
    await prisma.idempotencyRecord.deleteMany({ where: { scope, key } });
    await prisma.reservation.deleteMany({
      where: { restaurantId: testRestaurantId, idempotencyScope: scope, idempotencyKey: key },
    });

    const attempts = Array.from({ length: 50 }, async () => {
      const result = await idem.reserve({ scope, key, payloadHash, ttlSeconds: 60 });
      return result;
    });

    const results = await Promise.all(attempts);
    const reserved = results.filter((r) => r === 'reserved').length;
    const reused = results.filter((r) => r === 'reused').length;
    expect(reserved).toBe(1);
    expect(reused).toBe(49);
    expect(reserved + reused).toBe(50);
  });

  it('mêmes scope+key mais payload différent → IdempotencyConflictError', async () => {
    const scope = computeIdempotencyScope({
      restaurantId: testRestaurantId,
      channel: 'MCP',
      clientId: 'conflict-test',
    });
    const key = 'idem-conflict-key';
    const payload1 = { partySize: 2, startsAt: '2026-12-02T19:00:00Z' };
    const payload2 = { partySize: 4, startsAt: '2026-12-02T19:00:00Z' };
    const hash1 = hashPayload(payload1);
    const hash2 = hashPayload(payload2);

    await prisma.idempotencyRecord.deleteMany({ where: { scope, key } });

    // Premier insert
    await idem.reserve({ scope, key, payloadHash: hash1, ttlSeconds: 60 });
    await idem.complete({ scope, key, payloadHash: hash1, reservationId: 'fake-res' });

    // Deuxième insert avec payload différent
    await expect(idem.reserve({ scope, key, payloadHash: hash2, ttlSeconds: 60 })).rejects.toThrow(
      /conflict/i,
    );
  });
});

describeIntegration('audit log — append-only enforcement', () => {
  it('UPDATE sur reservation_audit_log est rejeté par le trigger', async () => {
    // Crée un log
    const log = await prisma.reservationAuditLog.create({
      data: {
        event: 'hold_created',
        actor: 'test',
        metadata: {},
      },
    });

    // Tente un UPDATE
    await expect(
      prisma.reservationAuditLog.update({
        where: { id: log.id },
        data: { actor: 'tampered' },
      }),
    ).rejects.toThrow();

    // Cleanup
    await prisma.reservationAuditLog
      .deleteMany({
        where: { id: log.id },
      })
      .catch(() => {
        // Le trigger refuse DELETE — c'est attendu, on le démontre ici
      });
  });

  it('DELETE sur reservation_audit_log est rejeté par le trigger', async () => {
    const log = await prisma.reservationAuditLog.create({
      data: {
        event: 'hold_created',
        actor: 'test',
        metadata: {},
      },
    });

    await expect(prisma.reservationAuditLog.delete({ where: { id: log.id } })).rejects.toThrow();
  });
});

describeIntegration('legacy reservation delete — terminal state with audit', () => {
  it('clôture une réservation auditée sans suppression physique', async () => {
    const slot = nextCapacitySlot();
    const reservationId = await createCapacityReservation({
      state: 'CONFIRMED',
      tableId: testTableId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    });

    await prisma.reservationAuditLog.create({
      data: {
        event: 'reservation_table_released',
        reservationId,
        actor: 'test',
        fromState: 'CONFIRMED',
        toState: 'CONFIRMED',
        metadata: {},
      },
    });

    await LegacyReservationService.delete(reservationId, testRestaurantId);

    const retained = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { status: true, state: true },
    });
    expect(retained).toMatchObject({ status: 'CANCELLED', state: 'CANCELLED' });

    const deletionAudit = await prisma.reservationAuditLog.findFirst({
      where: { reservationId, event: 'reservation_deleted' },
    });
    expect(deletionAudit).toBeTruthy();
    expect(deletionAudit?.fromState).toBe('CONFIRMED');
    expect(deletionAudit?.toState).toBe('CANCELLED');

    const operationalRows = await LegacyReservationService.findByRestaurant(testRestaurantId);
    expect(operationalRows.some((row) => row.id === reservationId)).toBe(false);
  });
});

describeIntegration('capacity — active reservations with or without table', () => {
  it.each(ACTIVE_RESERVATION_STATES)(
    '%s bloque avec ou sans table dans CapacityAwareAvailabilityService',
    async (state) => {
      const withTable = nextCapacitySlot();
      const withoutTable = nextCapacitySlot();
      const reservationIds = await Promise.all([
        createCapacityReservation({
          state,
          tableId: testTableId,
          startsAt: withTable.startsAt,
          endsAt: withTable.endsAt,
        }),
        createCapacityReservation({
          state,
          tableId: null,
          startsAt: withoutTable.startsAt,
          endsAt: withoutTable.endsAt,
        }),
      ]);

      try {
        const service = new CapacityAwareAvailabilityService(prisma);

        await expect(slotAvailability(service, withTable.date)).resolves.toBe(false);
        await expect(slotAvailability(service, withoutTable.date)).resolves.toBe(false);
      } finally {
        await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
      }
    },
  );
});

describeIntegration('capacity — active holds with or without table', () => {
  it.each([
    { label: 'avec table', withTable: true, physicalAvailable: false },
    { label: 'sans table', withTable: false, physicalAvailable: true },
  ])(
    '$label : vérifie les deux prédicats de capacité',
    async ({ withTable, physicalAvailable }) => {
      const slot = nextCapacitySlot();
      const holdId = await createCapacityHold({
        tableId: withTable ? testTableId : null,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });

      try {
        const availability = new CapacityAwareAvailabilityService(prisma);
        const allocation = new TableAllocationService(prisma);

        await expect(slotAvailability(availability, slot.date)).resolves.toBe(false);
        await expect(
          allocation.isTableAvailable({
            tableId: testTableId,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
          }),
        ).resolves.toBe(physicalAvailable);
      } finally {
        await prisma.agenticHold.delete({ where: { id: holdId } });
      }
    },
  );
});

describeIntegration('capacity — explicit table hold revalidation', () => {
  it.each([
    { label: 'réservation active sans table', blocker: 'reservation-global' as const },
    { label: 'hold actif sans table', blocker: 'hold-global' as const },
    { label: 'réservation active sur la table', blocker: 'reservation-table' as const },
    { label: 'hold actif sur la table', blocker: 'hold-table' as const },
  ])('$label : refuse un hold avec tableId explicite', async ({ blocker }) => {
    const slot = nextCapacitySlot();
    let reservationId: string | null = null;
    let holdId: string | null = null;

    if (blocker.startsWith('reservation')) {
      reservationId = await createCapacityReservation({
        state: 'CONFIRMED',
        tableId: blocker === 'reservation-table' ? testTableId : null,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });
    } else {
      holdId = await createCapacityHold({
        tableId: blocker === 'hold-table' ? testTableId : null,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });
    }

    try {
      await expect(
        holds.createHold({
          restaurantId: testRestaurantId,
          partySize: 4,
          slotStart: slot.startsAt,
          slotEnd: slot.endsAt,
          channel: 'MCP',
          policy,
          actor: 'agent:explicit-table-test',
          tableId: testTableId,
        }),
      ).rejects.toBeInstanceOf(HoldConflictError);

      const created = await prisma.agenticHold.count({
        where: {
          restaurantId: testRestaurantId,
          slotStart: slot.startsAt,
          type: 'HOLD',
          status: 'ACTIVE',
        },
      });
      expect(created).toBe(holdId ? 1 : 0);
    } finally {
      if (reservationId) {
        await prisma.reservation.delete({ where: { id: reservationId } });
      }
      if (holdId) {
        await prisma.agenticHold.delete({ where: { id: holdId } });
      }
    }
  });
});

describeIntegration('capacity — releaseTable', () => {
  it.each(ACTIVE_RESERVATION_STATES)(
    '%s détache la table sans changer la réservation ; la capacité globale reste bloquée',
    async (state) => {
      const slot = nextCapacitySlot();
      const reservationId = await createCapacityReservation({
        state,
        tableId: testTableId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });

      const allocation = new TableAllocationService(prisma);
      await allocation.releaseTable(reservationId);

      const reservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        select: { tableId: true, state: true, status: true },
      });
      expect(reservation).toEqual({
        tableId: null,
        state,
        status: state === 'SEATED' ? 'SEATED' : 'CONFIRMED',
      });

      await expect(
        allocation.isTableAvailable({
          tableId: testTableId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        }),
      ).resolves.toBe(true);
      await expect(
        slotAvailability(new CapacityAwareAvailabilityService(prisma), slot.date),
      ).resolves.toBe(false);
    },
  );
});

describeIntegration('capacity — réservation active sans table dans le chemin agentic', () => {
  it.each(ACTIVE_RESERVATION_STATES)(
    '%s est bloquante pour findBlockingReservation même sans table',
    async (state) => {
      const slot = nextCapacitySlot();
      const reservationId = await createCapacityReservation({
        state,
        tableId: null,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });
      const scope = `${testRestaurantId}:capacity-global:${state}:${randomUUID()}`;
      const key = `capacity-global-${randomUUID()}`;
      const service = new ReservationService(prisma, audit, holds, idem);

      try {
        await expect(
          service.createReservation(
            {
              restaurantId: testRestaurantId,
              partySize: 4,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              customerName: 'Capacity contender',
              customerPhone: '+33600000001',
              channel: 'MCP',
              policy,
              actor: 'test:capacity',
            },
            {
              scope,
              key,
              payloadHash: hashPayload({
                partySize: 4,
                startsAt: slot.startsAt.toISOString(),
              }),
              ttlSeconds: 60,
            },
          ),
        ).rejects.toBeInstanceOf(ReservationSlotUnavailableError);
      } finally {
        await prisma.reservation.delete({ where: { id: reservationId } });
        await prisma.idempotencyRecord.deleteMany({ where: { scope, key } });
      }
    },
  );
});

/**
 * Parité des deux entrées d'écriture (R1-4).
 *
 * Les deux services restent deux implémentations, mais ils écrivent les mêmes
 * deux colonnes : `state` (agentic) et `status` (historique, projeté). Ce bloc
 * exécute les deux contre une vraie base et compare leurs sorties normalisées.
 * C'est ce qui rend le harness shadow utile : jusqu'ici il ne comparait que des
 * fixtures statiques, donc il ne pouvait pas détecter une divergence réelle.
 */
describeIntegration('contrat — parité des deux entrées d’écriture (R1-4)', () => {
  async function createViaLegacy(args: { startsAt: Date; name: string; phone: string }) {
    return LegacyReservationService.create({
      restaurantId: testRestaurantId,
      reservedAt: args.startsAt,
      partySize: 4,
      customerName: args.name,
      customerPhone: args.phone,
    });
  }

  async function createViaAgentic(args: {
    startsAt: Date;
    endsAt: Date;
    name: string;
    phone: string;
    policySnapshot?: typeof policy;
  }) {
    const service = new ReservationService(prisma, audit, holds, idem);
    return service.createReservation(
      {
        restaurantId: testRestaurantId,
        partySize: 4,
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        customerName: args.name,
        customerPhone: args.phone,
        channel: 'MCP',
        policy: args.policySnapshot ?? policy,
        actor: 'test:parity',
      },
      parityIdempotency(randomUUID()),
    );
  }

  /** Snapshot normalisé, construit sur la ligne et l'audit réellement écrits. */
  async function readContract(reservationId: string, idempotency: 'keyed' | 'unkeyed') {
    const [row, audits] = await Promise.all([
      prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        select: { status: true, state: true },
      }),
      prisma.reservationAuditLog.findMany({
        where: { reservationId },
        select: { event: true },
        orderBy: { event: 'asc' },
      }),
    ]);
    return normalizeReservationContractResult({
      outcome: 'committed',
      status: row.status,
      state: row.state,
      idempotency,
      auditEvents: audits.map((entry) => entry.event),
      notificationJobs: [],
      // Les deux scénarios sont des créations : la capacité vient d'être prise.
      capacity: 'reserved',
      hold: 'none',
    });
  }

  it('les deux services respectent la projection canonique à la création', async () => {
    const legacySlot = nextCapacitySlot();
    const legacy = await createViaLegacy({
      startsAt: legacySlot.startsAt,
      name: 'Parité legacy',
      phone: parityPhone(),
    });

    const agenticSlot = nextCapacitySlot();
    const agentic = await createViaAgentic({
      startsAt: agenticSlot.startsAt,
      endsAt: agenticSlot.endsAt,
      name: 'Parité agentic',
      phone: parityPhone(),
    });

    const rows = await prisma.reservation.findMany({
      where: { id: { in: [legacy.id, agentic.reservationId] } },
      select: { id: true, status: true, state: true },
    });
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(isReservationState(row.state)).toBe(true);
      // Invariant canonique : `status` est exactement ce que projette `state`.
      expect(row.status).toBe(creationProjection(row.state as CreatableReservationState).status);
      expect(row).toMatchObject({ status: 'CONFIRMED', state: 'CONFIRMED' });
    }
  });

  it('la validation manuelle reste non ferme malgré status=CONFIRMED', async () => {
    const slot = nextCapacitySlot();
    const phone = parityPhone();

    const created = await createViaAgentic({
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      name: 'Parité validation manuelle',
      phone,
      policySnapshot: manualValidationPolicy,
    });

    const row = await prisma.reservation.findUniqueOrThrow({
      where: { id: created.reservationId },
      select: { status: true, state: true },
    });

    // Projection lossy assumée : l'énumération historique ne sait pas exprimer
    // « en attente de validation », donc `status` porte CONFIRMED.
    expect(row).toEqual({ status: 'CONFIRMED', state: 'PENDING' });
    expect(isConfirmedReservation(row)).toBe(false);

    // Filtre réel du handler de réponse SMS (status **et** state). C'est le bug
    // corrigé en R1-4 : sur `status` seul, un « NON » annulait cette ligne.
    const matched = await prisma.reservation.findFirst({
      where: {
        customerPhone: phone,
        status: 'CONFIRMED',
        state: 'CONFIRMED',
        confirmationStatus: 'PENDING',
        reservedAt: {
          gte: new Date(slot.startsAt.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(slot.startsAt.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true },
    });
    expect(matched).toBeNull();
  });

  it('le harness shadow compare les deux entrées sur des faits réels', async () => {
    const legacySlot = nextCapacitySlot();
    const legacy = await createViaLegacy({
      startsAt: legacySlot.startsAt,
      name: 'Parité shadow legacy',
      phone: parityPhone(),
    });

    const agenticSlot = nextCapacitySlot();
    const agentic = await createViaAgentic({
      startsAt: agenticSlot.startsAt,
      endsAt: agenticSlot.endsAt,
      name: 'Parité shadow agentic',
      phone: parityPhone(),
    });

    const comparison = compareReservationContractResults(
      await readContract(legacy.id, 'unkeyed'),
      await readContract(agentic.reservationId, 'keyed'),
    );

    expect(comparison.legacy).toMatchObject({ status: 'CONFIRMED', state: 'CONFIRMED' });
    expect(comparison.agentic).toMatchObject({ status: 'CONFIRMED', state: 'CONFIRMED' });

    // Les deux colonnes d'état sont identiques : c'est la convergence visée.
    // Les écarts restants sont assumés et restent visibles ici.
    expect(comparison.legacy.auditEvents).toEqual(['reservation_created']);
    // Le chemin agentic matérialise un hold même sans token fourni ; le chemin
    // legacy n'a pas cette notion.
    expect(comparison.agentic.auditEvents).toEqual(['hold_consumed', 'reservation_created']);

    // Toute différence supplémentaire fait échouer ce test, ce qui force une
    // décision explicite plutôt qu'une dérive silencieuse entre les deux entrées.
    expect(comparison.differences).toEqual(['idempotency', 'auditEvents']);
  });
});
