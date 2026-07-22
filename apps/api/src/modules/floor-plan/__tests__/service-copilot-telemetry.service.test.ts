import { describe, expect, it, vi } from 'vitest';
import { ServiceCopilotTelemetryService } from '../service-copilot-telemetry.service';

function makePrismaMock() {
  const occurrences = new Map<string, any>();
  const events = new Map<string, any>();
  const copilotOccurrence = {
    upsert: vi.fn(async ({ where, create }) => {
      const key = `${where.restaurantId_occurrenceKey.restaurantId}:${where.restaurantId_occurrenceKey.occurrenceKey}`;
      const existing = occurrences.get(key);
      if (existing) return existing;
      const created = { id: `occ-${occurrences.size + 1}`, ...create };
      occurrences.set(key, created);
      return created;
    }),
    update: vi.fn(async ({ where, data }) => {
      const occurrence = [...occurrences.values()].find((item) => item.id === where.id);
      Object.assign(occurrence, data);
      return occurrence;
    }),
    findUnique: vi.fn(
      async ({ where }) => [...occurrences.values()].find((item) => item.id === where.id) ?? null,
    ),
    findMany: vi.fn(async () => []),
    groupBy: vi.fn(
      async (): Promise<Array<{ kind: string; status: string; _count: { _all: number } }>> => [],
    ),
  };
  const copilotTelemetryEvent = {
    findUnique: vi.fn(async ({ where }) => events.get(where.idempotencyKey) ?? null),
    create: vi.fn(async ({ data }) => {
      const created = { id: `evt-${events.size + 1}`, ...data };
      events.set(data.idempotencyKey, created);
      return created;
    }),
  };
  return {
    prisma: { copilotOccurrence, copilotTelemetryEvent } as any,
    copilotOccurrence,
    copilotTelemetryEvent,
    occurrences,
  };
}

const recommendation = {
  id: 'rec-1',
  occurrenceKey: 'reported-delay:delay-1',
  ruleVersion: 'v1',
  kind: 'reported-delay' as const,
  priority: 'high' as const,
  title: 'Retard signalé',
  reason: 'Test',
  action: { type: 'link' as const, label: 'Analyser', href: '/dashboard/floor-plan' },
  entityId: 'reservation-1',
  expiresAt: '2026-08-01T20:00:00.000Z',
};

describe('ServiceCopilotTelemetryService', () => {
  it('accepte un jeton signé, enregistre une vue et déduplique le même événement', async () => {
    const { prisma, copilotOccurrence, copilotTelemetryEvent, occurrences } = makePrismaMock();
    const service = new ServiceCopilotTelemetryService(
      prisma,
      'mock_telemetry_signing_key_32bytes_long',
    );
    const token = service.issueToken({ restaurantId: 'rest-1', recommendation });

    await expect(
      service.recordClientEvent({
        restaurantId: 'rest-1',
        token: token!,
        event: 'VIEWED',
        idempotencyKey: 'view-1',
        actor: 'user-1',
      }),
    ).resolves.toEqual({ idempotent: false });
    await expect(
      service.recordClientEvent({
        restaurantId: 'rest-1',
        token: token!,
        event: 'VIEWED',
        idempotencyKey: 'view-1',
      }),
    ).resolves.toEqual({ idempotent: true });

    expect(copilotOccurrence.upsert).toHaveBeenCalledTimes(2);
    expect(copilotTelemetryEvent.create).toHaveBeenCalledTimes(1);
    expect([...occurrences.values()][0]).toMatchObject({
      restaurantId: 'rest-1',
      occurrenceKey: recommendation.occurrenceKey,
      status: 'OBSERVED',
    });
  });

  it('refuse un jeton falsifié ou présenté dans un autre restaurant', async () => {
    const { prisma } = makePrismaMock();
    const service = new ServiceCopilotTelemetryService(
      prisma,
      'mock_telemetry_signing_key_32bytes_long',
    );
    const token = service.issueToken({ restaurantId: 'rest-1', recommendation })!;

    await expect(
      service.recordClientEvent({
        restaurantId: 'rest-2',
        token,
        event: 'VIEWED',
        idempotencyKey: 'wrong-tenant',
      }),
    ).rejects.toThrow('invalide');
    await expect(
      service.recordClientEvent({
        restaurantId: 'rest-1',
        token: `${token}x`,
        event: 'VIEWED',
        idempotencyKey: 'tampered',
      }),
    ).rejects.toThrow('invalide');
  });

  it('conserve l’état appliqué face à un conflit ultérieur, puis trace le retour arrière', async () => {
    const { prisma, occurrences } = makePrismaMock();
    const service = new ServiceCopilotTelemetryService(
      prisma,
      'mock_telemetry_signing_key_32bytes_long',
    );
    const common = {
      restaurantId: 'rest-1',
      occurrenceKey: recommendation.occurrenceKey,
      kind: recommendation.kind,
      entityId: recommendation.entityId,
      ruleVersion: recommendation.ruleVersion,
      expiresAt: new Date(recommendation.expiresAt),
    };

    await service.recordServerEvent({ ...common, event: 'APPLIED', idempotencyKey: 'apply-1' });
    await service.recordServerEvent({
      ...common,
      event: 'CONFLICTED',
      idempotencyKey: 'conflict-1',
    });
    await service.recordServerEvent({ ...common, event: 'REVERTED', idempotencyKey: 'revert-1' });

    expect([...occurrences.values()][0].status).toBe('REVERTED');
  });

  it('agrège les résultats du shadow mode par statut et type de recommandation', async () => {
    const { prisma, copilotOccurrence } = makePrismaMock();
    copilotOccurrence.groupBy.mockResolvedValue([
      { kind: 'reported-delay', status: 'APPLIED', _count: { _all: 4 } },
      { kind: 'reported-delay', status: 'CONFLICTED', _count: { _all: 1 } },
      { kind: 'waiting-list-compatible', status: 'IGNORED', _count: { _all: 2 } },
    ]);
    const service = new ServiceCopilotTelemetryService(
      prisma,
      'a-very-long-telemetry-secret-at-least-32',
    );

    const summary = await service.getSummary({
      restaurantId: 'rest-1',
      days: 7,
      now: new Date('2026-07-22T18:00:00.000Z'),
    });

    expect(summary.totals).toMatchObject({ applied: 4, conflicted: 1, ignored: 2 });
    expect(summary.byKind).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'reported-delay',
          totals: expect.objectContaining({ applied: 4, conflicted: 1 }),
        }),
      ]),
    );
  });

  it('permet de qualifier après service une recommandation ouverte puis expirée', async () => {
    const { prisma, occurrences } = makePrismaMock();
    const service = new ServiceCopilotTelemetryService(
      prisma,
      'a-very-long-telemetry-secret-at-least-32',
    );
    await service.recordServerEvent({
      restaurantId: 'rest-1',
      occurrenceKey: recommendation.occurrenceKey,
      kind: recommendation.kind,
      entityId: recommendation.entityId,
      ruleVersion: recommendation.ruleVersion,
      event: 'OPENED',
      idempotencyKey: 'opened-1',
    });
    const occurrence = [...occurrences.values()][0];
    occurrence.status = 'EXPIRED';

    await expect(
      service.recordManualOutcome({
        restaurantId: 'rest-1',
        occurrenceId: occurrence.id,
        event: 'APPLIED',
        actor: 'user-1',
      }),
    ).resolves.toEqual({ idempotent: false });

    expect(occurrence.status).toBe('APPLIED');
  });
});
