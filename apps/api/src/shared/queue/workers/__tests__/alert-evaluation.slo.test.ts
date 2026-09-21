import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db/client';
import { redisCache } from '../../../redis/client';
import { sloStatusGauge, sloValueGauge } from '../../../observability/metrics';
import type { MetricSnapshot } from '../../../observability/alert-evaluator';
import { evaluateSloTick } from '../alert-evaluation.worker';

const dispatchAlert = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../../observability/alert-dispatcher', () => ({ dispatchAlert }));

function snapshot(overrides: {
  httpRequests?: Record<string, number>;
  connectRequestCount?: Record<string, number>;
}): MetricSnapshot {
  return {
    timestamp: 1,
    counters: {
      httpRequests: overrides.httpRequests ?? {},
      connectRequestCount: overrides.connectRequestCount ?? {},
    },
    histograms: { connectRequestBuckets: {} },
  };
}

const silentLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

describe('evaluateSloTick', () => {
  beforeEach(() => {
    dispatchAlert.mockClear();
    sloStatusGauge.reset();
    sloValueGauge.reset();
    // Le mock ioredis renvoie `undefined` par défaut ; le cooldown attend `null`
    // quand aucune clé n'existe, sinon toute alerte serait vue comme supprimée.
    vi.mocked(redisCache.get).mockResolvedValue(null);
    vi.mocked(db.call.count).mockResolvedValue(0);
    vi.mocked(db.reservation.count).mockResolvedValue(0);
  });

  it('marque la disponibilité API manquée et dispatche un finding', async () => {
    // Delta de la fenêtre : 1000 requêtes 2xx, 20 requêtes 5xx → 98 % de
    // disponibilité, sous l'objectif de 99 %.
    const prev = snapshot({ httpRequests: { 'status_class=2xx': 100 } });
    const cur = snapshot({ httpRequests: { 'status_class=2xx': 1100, 'status_class=5xx': 20 } });

    const result = await evaluateSloTick({
      prevSnapshot: prev,
      curSnapshot: cur,
      baselineReset: false,
      log: silentLog,
    });

    const availability = result.measurements.find((m) => m.id === 'api_availability');
    expect(availability?.status).toBe('breached');
    expect(availability?.value).toBeCloseTo(1 - 20 / 1020, 5);

    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'slo_breach', severity: 'warning' }),
    );
    expect(result.breached).toBe(1);
  });

  it('publie les gauges de statut et de valeur', async () => {
    // Delta : 1000 requêtes 2xx, 1 requête 5xx → 99,9 % de disponibilité.
    const prev = snapshot({ httpRequests: { 'status_class=2xx': 1000 } });
    const cur = snapshot({ httpRequests: { 'status_class=2xx': 2000, 'status_class=5xx': 1 } });

    await evaluateSloTick({
      prevSnapshot: prev,
      curSnapshot: cur,
      baselineReset: false,
      log: silentLog,
    });

    const status = await sloStatusGauge.get();
    const apiStatus = status.values.find((value) => value.labels.slo === 'api_availability');
    expect(apiStatus?.value).toBe(1);

    const voiceStatus = status.values.find(
      (value) => value.labels.slo === 'voice_transcript_coverage',
    );
    expect(voiceStatus?.value).toBe(-1);
  });

  it('ne déclenche rien quand la baseline est absente (redémarrage)', async () => {
    const cur = snapshot({ httpRequests: { 'status_class=5xx': 50 } });

    const result = await evaluateSloTick({
      prevSnapshot: null,
      curSnapshot: cur,
      baselineReset: true,
      log: silentLog,
    });

    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(result.breached).toBe(0);
    expect(result.measurements.find((m) => m.id === 'api_availability')?.status).toBe('unknown');
  });

  it('mesure les SLO métier quand la base répond', async () => {
    vi.mocked(db.call.count).mockResolvedValueOnce(100).mockResolvedValueOnce(0);
    vi.mocked(db.reservation.count).mockResolvedValueOnce(100).mockResolvedValueOnce(5);

    const result = await evaluateSloTick({
      prevSnapshot: snapshot({}),
      curSnapshot: snapshot({}),
      baselineReset: false,
      log: silentLog,
    });

    expect(result.measurements.find((m) => m.id === 'voice_transcript_coverage')?.status).toBe(
      'met',
    );
    expect(
      result.measurements.find((m) => m.id === 'reservation_confirmation_coverage')?.status,
    ).toBe('breached');
  });
});
