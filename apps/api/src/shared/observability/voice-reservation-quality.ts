import { Prisma, type PrismaClient } from '@prisma/client';
import {
  voiceReservationsCancelledAfterCall7dGauge,
  voiceReservationsChangedAfterCall7dGauge,
  voiceReservationsCreated7dGauge,
} from './metrics';

interface VoiceReservationQualityRow {
  created_count: bigint | number | string;
  changed_date_count: bigint | number | string;
  changed_time_count: bigint | number | string;
  changed_party_size_count: bigint | number | string;
  cancelled_count: bigint | number | string;
}

export interface VoiceReservationQualitySnapshot {
  created7d: number;
  changedAfterCall7d: { date: number; time: number; party_size: number };
  cancelledAfterCall7d: number;
}

function count(value: bigint | number | string | undefined): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

/** Read-only snapshot for phone reservations associated with an actual call. */
export async function collectVoiceReservationQualitySnapshot(
  client: Pick<PrismaClient, '$queryRaw'>,
  now = new Date(),
): Promise<VoiceReservationQualitySnapshot> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const query = Prisma.sql`
    WITH voice_reservations AS (
      SELECT r.id, r.created_at
      FROM reservations AS r
      WHERE r.channel = 'PHONE'
        AND r.call_id IS NOT NULL
        AND r.created_at >= ${since}
        AND r.created_at < ${now}
    )
    SELECT
      COUNT(*) AS created_count,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM reservation_audit_log AS a
        WHERE a.reservation_id = r.id
          AND a.created_at > r.created_at
          AND a.created_at <= r.created_at + INTERVAL '48 hours'
          AND a.metadata -> 'changedFields' ? 'date'
      )) AS changed_date_count,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM reservation_audit_log AS a
        WHERE a.reservation_id = r.id
          AND a.created_at > r.created_at
          AND a.created_at <= r.created_at + INTERVAL '48 hours'
          AND a.metadata -> 'changedFields' ? 'time'
      )) AS changed_time_count,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM reservation_audit_log AS a
        WHERE a.reservation_id = r.id
          AND a.created_at > r.created_at
          AND a.created_at <= r.created_at + INTERVAL '48 hours'
          AND a.metadata -> 'changedFields' ? 'party_size'
      )) AS changed_party_size_count,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM reservation_audit_log AS a
        WHERE a.reservation_id = r.id
          AND a.event IN ('reservation_cancelled', 'reservation_deleted')
          AND a.created_at >= r.created_at
          AND a.created_at < ${now}
      )) AS cancelled_count
    FROM voice_reservations AS r
  `;

  const [row] = await client.$queryRaw<VoiceReservationQualityRow[]>(query);
  return {
    created7d: count(row?.created_count),
    changedAfterCall7d: {
      date: count(row?.changed_date_count),
      time: count(row?.changed_time_count),
      party_size: count(row?.changed_party_size_count),
    },
    cancelledAfterCall7d: count(row?.cancelled_count),
  };
}

/** Refreshes only Prometheus gauges after the read-only aggregate query succeeds. */
export async function refreshVoiceReservationQualityMetrics(
  client: Pick<PrismaClient, '$queryRaw'>,
  now = new Date(),
): Promise<VoiceReservationQualitySnapshot> {
  const snapshot = await collectVoiceReservationQualitySnapshot(client, now);
  voiceReservationsCreated7dGauge.set(snapshot.created7d);
  voiceReservationsChangedAfterCall7dGauge.set({ field: 'date' }, snapshot.changedAfterCall7d.date);
  voiceReservationsChangedAfterCall7dGauge.set({ field: 'time' }, snapshot.changedAfterCall7d.time);
  voiceReservationsChangedAfterCall7dGauge.set(
    { field: 'party_size' },
    snapshot.changedAfterCall7d.party_size,
  );
  voiceReservationsCancelledAfterCall7dGauge.set(snapshot.cancelledAfterCall7d);
  return snapshot;
}
