import { describe, expect, it, beforeEach } from 'vitest';
import { ConnectKpiService, CONNECT_TARGETS, __resetKpiCache } from '../connect-kpis.service';
import {
  connectEventsTotal,
  connectRequestDuration,
  piiLeaksTotal,
  __resetMetrics,
} from '../../../shared/observability/metrics';

describe('ConnectKpiService', () => {
  let service: ConnectKpiService;

  beforeEach(() => {
    service = new ConnectKpiService();
    // Reset toutes les métriques Prometheus
    __resetMetrics();
    // Reset le cache du payload Prometheus (invalide entre tests)
    __resetKpiCache();
  });

  it('expose les targets P1', () => {
    expect(CONNECT_TARGETS.holdToConfirmRateMin).toBe(0.3);
    expect(CONNECT_TARGETS.latencyP95MaxMs).toBe(500);
    expect(CONNECT_TARGETS.piiLeakMax).toBe(0);
    expect(CONNECT_TARGETS.aggregateRatingSafe).toBe(true);
  });

  it('taux hold→confirm normal (50 holds, 20 confirmed → 40%)', async () => {
    // 50 holds créés (source web + google)
    for (let i = 0; i < 30; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 20; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'google' });
    // 20 confirmés
    for (let i = 0; i < 15; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'google' });

    // p95 OK (< 500ms)
    for (let i = 0; i < 20; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    const kpis = await service.getKpis();
    expect(kpis.holdsTotal).toBe(50);
    expect(kpis.confirmedTotal).toBe(20);
    expect(kpis.holdToConfirmRate).toBeCloseTo(0.4, 2);
    expect(kpis.slos.holdToConfirmRateMin.met).toBe(true);
    expect(kpis.health).toBe('GREEN');
  });

  it("division par zéro (0 holds → taux = 0, pas d'exception)", async () => {
    // Aucun hold, aucune confirmation
    for (let i = 0; i < 20; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    const kpis = await service.getKpis();
    expect(kpis.holdsTotal).toBe(0);
    expect(kpis.confirmedTotal).toBe(0);
    expect(kpis.holdToConfirmRate).toBe(0);
    expect(kpis.slos.holdToConfirmRateMin.met).toBe(false);
    // 1 critère en échec (taux) → YELLOW
    expect(kpis.health).toBe('YELLOW');
  });

  it('taux exactement à 30% (boundary)', async () => {
    // 10 holds, 3 confirmés → 30% exactement
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 3; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });

    for (let i = 0; i < 20; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    const kpis = await service.getKpis();
    expect(kpis.holdToConfirmRate).toBeCloseTo(0.3, 2);
    // >= 30% → met
    expect(kpis.slos.holdToConfirmRateMin.met).toBe(true);
  });

  it('calcule le p95 exact depuis les buckets Prometheus (route slug)', async () => {
    // 18 mesures à 100ms, 1 à 250ms, 1 à 1000ms
    // p95 = 20 * 0.95 = 19ème observation → bucket 250ms
    for (let i = 0; i < 18; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);
    connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 250);
    connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 1000);

    // Taux OK
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });

    const kpis = await service.getKpis();
    expect(kpis.slugP95Ms).toBe(250);
    expect(kpis.slos.latencyP95MaxMs.met).toBe(true);
  });

  it('p95 > 500ms → SLO non met', async () => {
    // 19 mesures à 1000ms, 1 mesure à 100ms → p95 = 1000ms bucket
    for (let i = 0; i < 19; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 1000);
    connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    // Taux OK
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });

    const kpis = await service.getKpis();
    expect(kpis.slugP95Ms).toBeGreaterThan(500);
    expect(kpis.slos.latencyP95MaxMs.met).toBe(false);
    // 1 critère en échec (latence) → YELLOW
    expect(kpis.health).toBe('YELLOW');
  });

  it('PII leaks > 0 → statut YELLOW ou RED', async () => {
    // Taux OK + latence OK
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });
    for (let i = 0; i < 20; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    // 1 PII leak
    piiLeaksTotal.inc({ kind: 'phone' });

    const kpis = await service.getKpis();
    expect(kpis.piiLeakIncidents).toBe(1);
    expect(kpis.slos.piiLeakMax.met).toBe(false);
    // 1 critère en échec (PII) → YELLOW
    expect(kpis.health).toBe('YELLOW');
  });

  it('statut global GREEN quand tous critères OK', async () => {
    // Taux 50% (≥30%)
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });

    // p95 < 500ms
    for (let i = 0; i < 20; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    // Pas de PII leak

    const kpis = await service.getKpis();
    expect(kpis.health).toBe('GREEN');
    expect(kpis.slos.holdToConfirmRateMin.met).toBe(true);
    expect(kpis.slos.latencyP95MaxMs.met).toBe(true);
    expect(kpis.slos.piiLeakMax.met).toBe(true);
    expect(kpis.slos.aggregateRatingSafe.met).toBe(true);
  });

  it('statut global RED quand ≥2 critères en échec', async () => {
    // Taux < 30% (10 holds, 1 confirmé → 10%)
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });

    // p95 > 500ms
    for (let i = 0; i < 19; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 1000);
    connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    // PII leak (3ème critère en échec)
    piiLeaksTotal.inc({ kind: 'email' });

    const kpis = await service.getKpis();
    expect(kpis.slos.holdToConfirmRateMin.met).toBe(false);
    expect(kpis.slos.latencyP95MaxMs.met).toBe(false);
    expect(kpis.slos.piiLeakMax.met).toBe(false);
    // 3 critères en échec → RED
    expect(kpis.health).toBe('RED');
  });

  it('retourne null pour p95 quand aucune observation slug', async () => {
    // Taux OK mais aucune observation de latence
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });

    const kpis = await service.getKpis();
    expect(kpis.slugP95Ms).toBeNull();
    expect(kpis.slos.latencyP95MaxMs.met).toBe(false);
    // 1 critère en échec (latence) → YELLOW
    expect(kpis.health).toBe('YELLOW');
  });

  it('somme les events across sources pour le taux', async () => {
    // Holds: 20 web + 10 google + 5 chatgpt = 35
    for (let i = 0; i < 20; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'web' });
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'google' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_hold_created', source: 'chatgpt' });

    // Confirmed: 10 web + 5 google = 15
    for (let i = 0; i < 10; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'web' });
    for (let i = 0; i < 5; i++)
      connectEventsTotal.inc({ event: 'reservation_confirmed', source: 'google' });

    for (let i = 0; i < 20; i++)
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);

    const kpis = await service.getKpis();
    expect(kpis.holdsTotal).toBe(35);
    expect(kpis.confirmedTotal).toBe(15);
    expect(kpis.holdToConfirmRate).toBeCloseTo(15 / 35, 2);
  });

  it('calcule le p95 en agrégeant les buckets across status codes', async () => {
    // 10 observations 2xx à 100ms + 5 observations 4xx à 250ms = 15 total
    // Buckets Prometheus : [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    for (let i = 0; i < 10; i++) {
      connectRequestDuration.observe({ route: 'slug', status: '2xx' }, 100);
    }
    for (let i = 0; i < 5; i++) {
      connectRequestDuration.observe({ route: 'slug', status: '4xx' }, 250);
    }
    const kpis = await service.getKpis();
    // p95 sur 15 observations : seuil = 0.95 * 15 = 14.25
    // bucket 100ms : 10 obs (2xx) + 0 (4xx, 250 > 100) = 10 < 14.25
    // bucket 250ms : 10 (2xx, 100 ≤ 250) + 5 (4xx, 250 ≤ 250) = 15 >= 14.25 → p95 = 250
    expect(kpis.slugP95Ms).toBe(250);
  });
});
