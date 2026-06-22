import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PilotKpiService, PILOT_TARGETS, __resetKpiCache } from '../pilot-kpis.service';
import {
  doubleBookingAttemptsTotal,
  piiLeaksTotal,
  holdCreatedTotal,
  checkAvailabilityDuration,
  reservationStateTransitionsTotal,
  __resetMetrics,
} from '../../../shared/observability/metrics';

function makeMockPrisma() {
  return {
    reservation: {
      count: vi.fn(),
    },
  } as any;
}

describe('PilotKpiService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: PilotKpiService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new PilotKpiService(prisma);
    // Reset les compteurs Prometheus
    doubleBookingAttemptsTotal.reset();
    piiLeaksTotal.reset();
    holdCreatedTotal.reset();
    checkAvailabilityDuration.reset();
    reservationStateTransitionsTotal.reset();
    // Reset le cache du payload Prometheus (invalide entre tests)
    __resetKpiCache();
  });

  it('expose les targets pilotes', () => {
    expect(PILOT_TARGETS.reservationsMin).toBe(100);
    expect(PILOT_TARGETS.honorRateMin).toBe(0.5);
    expect(PILOT_TARGETS.doubleBookingMax).toBe(0);
    expect(PILOT_TARGETS.piiLeakMax).toBe(0);
    expect(PILOT_TARGETS.latencyP95MaxMs).toBe(800);
  });

  it('GREEN quand tous les SLOs sont met', async () => {
    prisma.reservation.count
      .mockResolvedValueOnce(150) // reservationsTotal
      .mockResolvedValueOnce(100) // honored
      .mockResolvedValueOnce(20) // pending
      .mockResolvedValueOnce(15) // cancelled
      .mockResolvedValueOnce(15); // no_show
    // Simule des appels check_availability rapides (< 800ms)
    checkAvailabilityDuration.observe(50);
    checkAvailabilityDuration.observe(100);
    checkAvailabilityDuration.observe(200);
    const kpis = await service.getKpis();
    expect(kpis.health).toBe('GREEN');
    expect(kpis.slos.reservationsMin.met).toBe(true);
    expect(kpis.slos.honorRateMin.met).toBe(true);
    expect(kpis.checkAvailabilityP95Ms).not.toBeNull();
    expect(kpis.checkAvailabilityP95Ms).toBeLessThanOrEqual(800);
  });

  it('RED si double_booking > 0 (critique)', async () => {
    doubleBookingAttemptsTotal.inc();
    prisma.reservation.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const kpis = await service.getKpis();
    expect(kpis.health).toBe('RED');
    expect(kpis.doubleBookingAttempts).toBe(1);
  });

  it('RED si pii_leak > 0 (critique)', async () => {
    piiLeaksTotal.inc({ kind: 'phone' });
    prisma.reservation.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const kpis = await service.getKpis();
    expect(kpis.health).toBe('RED');
    expect(kpis.piiLeakIncidents).toBe(1);
  });

  it('honor_rate = 0 quand 0 résas', async () => {
    prisma.reservation.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const kpis = await service.getKpis();
    expect(kpis.honorRate).toBe(0);
    // SLO honor_rate min n'est pas met, mais comme c'est YELLOW (pas RED), c'est OK
    expect(kpis.slos.honorRateMin.met).toBe(false);
    expect(kpis.health).toBe('YELLOW');
  });

  it('expose reservationsTotal et reservationsHonored depuis DB', async () => {
    prisma.reservation.count
      .mockResolvedValueOnce(42) // total
      .mockResolvedValueOnce(25) // honored
      .mockResolvedValueOnce(5) // pending
      .mockResolvedValueOnce(2) // cancelled
      .mockResolvedValueOnce(10); // no_show
    const kpis = await service.getKpis();
    expect(kpis.reservationsTotal).toBe(42);
    expect(kpis.reservationsHonored).toBe(25);
    // honorRate = honored / (honored + cancelled + no_show) = 25 / 37
    expect(kpis.honorRate).toBeCloseTo(25 / 37, 2);
  });

  it('priorité DB sur Prometheus pour les compteurs business', async () => {
    // Prometheus dit 2 holds créés, DB dit 50
    holdCreatedTotal.inc();
    holdCreatedTotal.inc();
    prisma.reservation.count
      .mockResolvedValueOnce(50) // DB total
      .mockResolvedValueOnce(30) // DB honored
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5);
    const kpis = await service.getKpis();
    expect(kpis.reservationsTotal).toBe(50); // DB
    expect(kpis.reservationsHonored).toBe(30); // DB
  });

  describe('check_availability p95 latency', () => {
    beforeEach(() => {
      prisma.reservation.count
        .mockResolvedValueOnce(150) // reservationsTotal
        .mockResolvedValueOnce(100) // honored
        .mockResolvedValueOnce(20) // pending
        .mockResolvedValueOnce(15) // cancelled
        .mockResolvedValueOnce(15); // no_show
    });

    it('retourne null quand aucune observation', async () => {
      const kpis = await service.getKpis();
      expect(kpis.checkAvailabilityP95Ms).toBeNull();
      expect(kpis.slos.latencyP95MaxMs.met).toBe(false);
      // Pas de donnée = dégradation (YELLOW), pas critique (RED)
      expect(kpis.health).toBe('YELLOW');
    });

    it('SLO latency met quand p95 <= 800 ms', async () => {
      // 19 mesures <= 500ms, 1 mesure à 1000ms
      // p95 = 20ème observation = 500ms bucket (19/20 = 95%)
      for (let i = 0; i < 19; i++) checkAvailabilityDuration.observe(100);
      checkAvailabilityDuration.observe(1000);
      const kpis = await service.getKpis();
      expect(kpis.checkAvailabilityP95Ms).toBeLessThanOrEqual(800);
      expect(kpis.slos.latencyP95MaxMs.met).toBe(true);
      expect(kpis.health).toBe('GREEN');
    });

    it('SLO latency non met quand p95 > 800 ms', async () => {
      // 19 mesures à 1000ms, 1 mesure à 100ms
      // p95 = 1000ms bucket
      for (let i = 0; i < 19; i++) checkAvailabilityDuration.observe(1000);
      checkAvailabilityDuration.observe(100);
      const kpis = await service.getKpis();
      expect(kpis.checkAvailabilityP95Ms).toBeGreaterThan(800);
      expect(kpis.slos.latencyP95MaxMs.met).toBe(false);
      expect(kpis.health).toBe('YELLOW');
    });

    it('calcule le p95 exact depuis les buckets Prometheus', async () => {
      // 18 mesures à 100ms, 1 à 250ms, 1 à 1000ms
      // p95 = 20 * 0.95 = 19ème observation → bucket 250ms
      for (let i = 0; i < 18; i++) checkAvailabilityDuration.observe(100);
      checkAvailabilityDuration.observe(250);
      checkAvailabilityDuration.observe(1000);
      const kpis = await service.getKpis();
      expect(kpis.checkAvailabilityP95Ms).toBe(250);
    });
  });
});
