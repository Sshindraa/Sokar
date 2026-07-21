import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceTurnPredictionService } from '../service-turn-prediction.service';

function turnLogs(input: {
  id: string;
  tableId: string | null;
  partySize: number;
  seatedAt: Date;
  durationMinutes: number;
}) {
  return [
    {
      reservationId: input.id,
      event: 'reservation_seated',
      createdAt: input.seatedAt,
      reservation: { tableId: input.tableId, partySize: input.partySize },
    },
    {
      reservationId: input.id,
      event: 'reservation_honored',
      createdAt: new Date(input.seatedAt.getTime() + input.durationMinutes * 60_000),
      reservation: { tableId: input.tableId, partySize: input.partySize },
    },
  ];
}

describe('ServiceTurnPredictionService', () => {
  const findMany = vi.fn();
  const service = new ServiceTurnPredictionService({
    reservationAuditLog: { findMany },
  } as any);

  beforeEach(() => {
    findMany.mockReset();
  });

  it('privilégie les services comparables de la même table', async () => {
    const seatedAt = new Date('2026-07-21T17:00:00.000Z');
    findMany.mockResolvedValue(
      [75, 80, 85, 90, 95, 100].flatMap((durationMinutes, index) =>
        turnLogs({
          id: `turn-${index}`,
          tableId: 'table-terrasse-1',
          partySize: 2,
          seatedAt,
          durationMinutes,
        }),
      ),
    );

    const predictions = await service.predictForReservations({
      restaurantId: 'rest-1',
      scheduledDurationMinutes: 120,
      targets: [{ reservationId: 'active-1', tableId: 'table-terrasse-1', partySize: 2 }],
    });

    expect(predictions.get('active-1')).toEqual({
      durationMinutes: 90,
      lowerBoundMinutes: 80,
      upperBoundMinutes: 95,
      confidence: 'medium',
      source: 'historical-table',
      sampleSize: 6,
    });
  });

  it('retombe sur l’historique du restaurant pour la même taille de groupe', async () => {
    const seatedAt = new Date('2026-07-21T17:00:00.000Z');
    findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        turnLogs({
          id: `turn-${index}`,
          tableId: `table-${index}`,
          partySize: 4,
          seatedAt,
          durationMinutes: 80 + index,
        }),
      ).flat(),
    );

    const predictions = await service.predictForReservations({
      restaurantId: 'rest-1',
      scheduledDurationMinutes: 120,
      targets: [{ reservationId: 'active-1', tableId: 'new-table', partySize: 4 }],
    });

    expect(predictions.get('active-1')).toMatchObject({
      durationMinutes: 86,
      confidence: 'low',
      source: 'historical-restaurant',
      sampleSize: 12,
    });
  });

  it('conserve la durée configurée quand les données sont insuffisantes ou incohérentes', async () => {
    const seatedAt = new Date('2026-07-21T17:00:00.000Z');
    findMany.mockResolvedValue([
      ...turnLogs({
        id: 'too-short',
        tableId: 'table-1',
        partySize: 2,
        seatedAt,
        durationMinutes: 10,
      }),
      ...turnLogs({
        id: 'valid-but-not-enough',
        tableId: 'table-1',
        partySize: 2,
        seatedAt,
        durationMinutes: 90,
      }),
    ]);

    const predictions = await service.predictForReservations({
      restaurantId: 'rest-1',
      scheduledDurationMinutes: 120,
      targets: [{ reservationId: 'active-1', tableId: 'table-1', partySize: 2 }],
    });

    expect(predictions.get('active-1')).toEqual({
      durationMinutes: 120,
      lowerBoundMinutes: 120,
      upperBoundMinutes: 120,
      confidence: 'low',
      source: 'scheduled',
      sampleSize: 1,
    });
  });
});
