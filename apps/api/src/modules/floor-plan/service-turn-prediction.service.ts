import type { PrismaClient } from '@prisma/client';

const LOOKBACK_DAYS = 90;
const MIN_TURN_MINUTES = 30;
const MAX_TURN_MINUTES = 360;
const TABLE_SAMPLE_MINIMUM = 6;
const RESTAURANT_SAMPLE_MINIMUM = 12;

export type TurnPredictionConfidence = 'high' | 'medium' | 'low';
export type TurnPredictionSource = 'historical-table' | 'historical-restaurant' | 'scheduled';

export interface TurnPrediction {
  durationMinutes: number;
  lowerBoundMinutes: number;
  upperBoundMinutes: number;
  confidence: TurnPredictionConfidence;
  source: TurnPredictionSource;
  sampleSize: number;
}

interface TurnTarget {
  reservationId: string;
  tableId: string | null;
  partySize: number;
}

interface TurnSample {
  tableId: string | null;
  partySize: number;
  durationMinutes: number;
}

function partyBucket(partySize: number): string {
  if (partySize <= 2) return '1-2';
  if (partySize <= 4) return '3-4';
  if (partySize <= 6) return '5-6';
  return '7+';
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.round((sorted.length - 1) * ratio);
  return sorted[index] ?? 0;
}

function predictionFromSamples(
  samples: TurnSample[],
  source: Exclude<TurnPredictionSource, 'scheduled'>,
): TurnPrediction {
  const durations = samples.map((sample) => sample.durationMinutes).sort((a, b) => a - b);
  const sampleSize = durations.length;
  const confidence: TurnPredictionConfidence =
    source === 'historical-table' && sampleSize >= 20
      ? 'high'
      : source === 'historical-table' || sampleSize >= 30
        ? 'medium'
        : 'low';

  return {
    durationMinutes: percentile(durations, 0.5),
    lowerBoundMinutes: percentile(durations, 0.25),
    upperBoundMinutes: percentile(durations, 0.75),
    confidence,
    source,
    sampleSize,
  };
}

/**
 * Prévision de durée de service, volontairement explicable et en lecture seule.
 *
 * La source de vérité est l'audit append-only : `reservation_seated` puis
 * `reservation_honored`. Tant que l'historique est insuffisant, le Copilot
 * conserve la durée configurée par le restaurant et signale sa faible confiance.
 */
export class ServiceTurnPredictionService {
  constructor(private readonly prisma: PrismaClient) {}

  async predictForReservations(args: {
    restaurantId: string;
    targets: TurnTarget[];
    scheduledDurationMinutes: number;
    now?: Date;
  }): Promise<Map<string, TurnPrediction>> {
    if (args.targets.length === 0) return new Map();

    const now = args.now ?? new Date();
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60_000);
    const logs = await this.prisma.reservationAuditLog.findMany({
      where: {
        event: { in: ['reservation_seated', 'reservation_honored'] },
        createdAt: { gte: since },
        reservation: { is: { restaurantId: args.restaurantId } },
      },
      select: {
        reservationId: true,
        event: true,
        createdAt: true,
        reservation: { select: { partySize: true, tableId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5_000,
    });

    const samples = this.toSamples(logs);
    const predictions = new Map<string, TurnPrediction>();

    for (const target of args.targets) {
      const bucket = partyBucket(target.partySize);
      const tableSamples = samples.filter(
        (sample) => sample.tableId === target.tableId && partyBucket(sample.partySize) === bucket,
      );
      const restaurantSamples = samples.filter(
        (sample) => partyBucket(sample.partySize) === bucket,
      );

      if (target.tableId && tableSamples.length >= TABLE_SAMPLE_MINIMUM) {
        predictions.set(
          target.reservationId,
          predictionFromSamples(tableSamples, 'historical-table'),
        );
      } else if (restaurantSamples.length >= RESTAURANT_SAMPLE_MINIMUM) {
        predictions.set(
          target.reservationId,
          predictionFromSamples(restaurantSamples, 'historical-restaurant'),
        );
      } else {
        predictions.set(target.reservationId, {
          durationMinutes: args.scheduledDurationMinutes,
          lowerBoundMinutes: args.scheduledDurationMinutes,
          upperBoundMinutes: args.scheduledDurationMinutes,
          confidence: 'low',
          source: 'scheduled',
          sampleSize: Math.max(tableSamples.length, restaurantSamples.length),
        });
      }
    }

    return predictions;
  }

  private toSamples(
    logs: Array<{
      reservationId: string | null;
      event: string;
      createdAt: Date;
      reservation: { partySize: number; tableId: string | null } | null;
    }>,
  ): TurnSample[] {
    const turns = new Map<
      string,
      { seatedAt?: Date; honoredAt?: Date; partySize: number; tableId: string | null }
    >();

    for (const log of logs) {
      if (!log.reservationId || !log.reservation) continue;
      const current = turns.get(log.reservationId) ?? {
        partySize: log.reservation.partySize,
        tableId: log.reservation.tableId,
      };
      if (log.event === 'reservation_seated' && !current.seatedAt) current.seatedAt = log.createdAt;
      if (log.event === 'reservation_honored') current.honoredAt = log.createdAt;
      turns.set(log.reservationId, current);
    }

    const samples: TurnSample[] = [];
    for (const turn of turns.values()) {
      if (!turn.seatedAt || !turn.honoredAt) continue;
      const durationMinutes = Math.round(
        (turn.honoredAt.getTime() - turn.seatedAt.getTime()) / 60_000,
      );
      if (durationMinutes < MIN_TURN_MINUTES || durationMinutes > MAX_TURN_MINUTES) continue;
      samples.push({ tableId: turn.tableId, partySize: turn.partySize, durationMinutes });
    }
    return samples;
  }
}
