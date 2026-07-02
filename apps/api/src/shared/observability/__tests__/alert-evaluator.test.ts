/**
 * Tests unitaires pour alert-evaluator.ts — fonctions pures (pas de Redis, pas de Sentry).
 *
 * Couvre :
 *   - computeCounterRate : calcul de taux par diff de snapshots
 *   - computeHistogramP95 : interpolation de p95 sur bucket deltas
 *   - detectedRestart : détection de process restart
 *   - evaluateAlerts : orchestration des 4 alertes
 *   - Edge cases : premier run, restart, aucune requête, cooldown
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeCounterRate,
  computeHistogramP95,
  detectedRestart,
  evaluateAlerts,
  captureSnapshot,
  type MetricSnapshot,
  type AlertCooldown,
} from '../alert-evaluator';
import { httpRequestsTotal, connectRequestDuration, __resetMetrics } from '../metrics';

// Mock Sentry — les fonctions d'alerte appellent captureMessage
vi.mock('../../sentry/client', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Helpers ───────────────────────────────────────────────

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    timestamp: Date.now(),
    counters: {
      httpRequests: {},
      connectRequestCount: {},
    },
    histograms: {
      connectRequestBuckets: {},
    },
    ...overrides,
  };
}

/** Cooldown mock — track toutes les appels pour assertions. */
function makeMockCooldown(): AlertCooldown & {
  fired: Array<{ kind: string; id: string }>;
  suppressSet: Set<string>;
} {
  const fired: Array<{ kind: string; id: string }> = [];
  const suppressSet = new Set<string>();
  return {
    fired,
    suppressSet,
    async shouldSuppress(kind: string, id: string) {
      return suppressSet.has(`${kind}:${id}`);
    },
    async markFired(kind: string, id: string) {
      fired.push({ kind, id });
      suppressSet.add(`${kind}:${id}`);
    },
  };
}

/** Crée un snapshot avec des counters HTTP simulés. */
function snapshotWithHttp(
  http: Record<string, number>,
  connectCount: Record<string, number> = {},
  connectBuckets: Record<string, Record<string, number>> = {},
): MetricSnapshot {
  return makeSnapshot({
    counters: {
      httpRequests: http,
      connectRequestCount: connectCount,
    },
    histograms: { connectRequestBuckets: connectBuckets },
  });
}

// ─── Tests ─────────────────────────────────────────────────

describe('alert-evaluator', () => {
  beforeEach(() => {
    __resetMetrics();
  });

  // ── computeCounterRate ───────────────────────────────────

  describe('computeCounterRate', () => {
    it('retourne rate=0 si pas de snapshot précédent (premier run)', () => {
      const cur = { 'status_class=2xx': 100, 'status_class=5xx': 5 };
      const result = computeCounterRate(
        null,
        cur,
        (k) => k.includes('5xx'),
        () => true,
      );
      expect(result.rate).toBe(0);
      expect(result.count).toBe(0);
      expect(result.total).toBe(0);
    });

    it('calcule le rate correctement entre deux snapshots', () => {
      const prev = { 'status_class=2xx': 100, 'status_class=5xx': 2 };
      const cur = { 'status_class=2xx': 190, 'status_class=5xx': 10 };
      // delta 5xx = 8, delta total = 98, rate = 8/98 ≈ 0.0816
      const result = computeCounterRate(
        prev,
        cur,
        (k) => k.includes('5xx'),
        () => true,
      );
      expect(result.count).toBe(8);
      expect(result.total).toBe(98);
      expect(result.rate).toBeCloseTo(8 / 98, 5);
    });

    it('retourne rate=0 si total delta est 0 (aucune nouvelle requête)', () => {
      const prev = { 'status_class=2xx': 100, 'status_class=5xx': 5 };
      const cur = { 'status_class=2xx': 100, 'status_class=5xx': 5 };
      const result = computeCounterRate(
        prev,
        cur,
        (k) => k.includes('5xx'),
        () => true,
      );
      expect(result.rate).toBe(0);
      expect(result.total).toBe(0);
    });

    it('gère les clés absentes du précédent (nouveau label)', () => {
      const prev = { 'status_class=2xx': 100 };
      const cur = { 'status_class=2xx': 150, 'status_class=5xx': 10 };
      // delta 5xx = 10 (nouveau label), delta total = 60
      const result = computeCounterRate(
        prev,
        cur,
        (k) => k.includes('5xx'),
        () => true,
      );
      expect(result.count).toBe(10);
      expect(result.total).toBe(60);
    });
  });

  // ── computeHistogramP95 ──────────────────────────────────

  describe('computeHistogramP95', () => {
    it('retourne 0 si pas de snapshot précédent', () => {
      const cur = { '5': 0, '10': 10, '25': 50, '+Inf': 100 };
      expect(computeHistogramP95(null, cur)).toBe(0);
    });

    it('retourne 0 si aucune observation dans la fenêtre', () => {
      const prev = { '5': 10, '+Inf': 50 };
      const cur = { '5': 10, '+Inf': 50 }; // delta = 0
      expect(computeHistogramP95(prev, cur)).toBe(0);
    });

    it('estime le p95 par interpolation linéaire', () => {
      // 100 observations entre 100ms et 250ms
      // p95 = 95e observation → dans le bucket [100, 250]
      // 95 - 80 (cumulatif à le=100) = 15 dans le bucket
      // bucket [100,250] a 20 observations (100 à 250)
      // fraction = 15/20 = 0.75
      // p95 = 100 + 0.75 * (250 - 100) = 100 + 112.5 = 212.5 → arrondi 213
      const prev = {
        '5': 0,
        '10': 0,
        '25': 0,
        '50': 0,
        '100': 0,
        '250': 0,
        '500': 0,
        '1000': 0,
        '2500': 0,
        '5000': 0,
        '+Inf': 0,
      };
      const cur = {
        '5': 0,
        '10': 0,
        '25': 0,
        '50': 0,
        '100': 80,
        '250': 100,
        '500': 100,
        '1000': 100,
        '2500': 100,
        '5000': 100,
        '+Inf': 100,
      };
      const p95 = computeHistogramP95(prev, cur);
      expect(p95).toBe(213); // 100 + 0.75 * 150 = 212.5 → round = 213
    });

    it('retourne le boundary inférieur si p95 tombe exactement sur une borne', () => {
      // 20 observations, toutes ≤ 50ms
      // p95 = 19e observation → dans le bucket [25, 50]
      // 19 - 15 (cumulatif à le=25) = 4 dans le bucket
      // bucket [25,50] a 5 observations (15 à 20)
      // fraction = 4/5 = 0.8
      // p95 = 25 + 0.8 * (50 - 25) = 25 + 20 = 45
      const prev = {
        '5': 0,
        '10': 0,
        '25': 0,
        '50': 0,
        '100': 0,
        '250': 0,
        '500': 0,
        '1000': 0,
        '2500': 0,
        '5000': 0,
        '+Inf': 0,
      };
      const cur = {
        '5': 5,
        '10': 10,
        '25': 15,
        '50': 20,
        '100': 20,
        '250': 20,
        '500': 20,
        '1000': 20,
        '2500': 20,
        '5000': 20,
        '+Inf': 20,
      };
      const p95 = computeHistogramP95(prev, cur);
      expect(p95).toBe(45);
    });

    it('gère les deltas négatifs (restart) en les clampant à 0', () => {
      const prev = { '5': 100, '+Inf': 200 };
      const cur = { '5': 10, '+Inf': 20 }; // valeurs inférieures → restart
      // deltas clampés à 0 → totalCount = 0 → p95 = 0
      expect(computeHistogramP95(prev, cur)).toBe(0);
    });
  });

  // ── detectedRestart ──────────────────────────────────────

  describe('detectedRestart', () => {
    it('détecte un restart quand la majorité des valeurs décroissent', () => {
      const prev = snapshotWithHttp({
        'status_class=2xx': 1000,
        'status_class=4xx': 100,
        'status_class=5xx': 50,
      });
      const cur = snapshotWithHttp({
        'status_class=2xx': 10, // < 1000
        'status_class=4xx': 1, // < 100
        'status_class=5xx': 0, // < 50
      });
      expect(detectedRestart(prev, cur)).toBe(true);
    });

    it('ne détecte pas de restart en fonctionnement normal', () => {
      const prev = snapshotWithHttp({
        'status_class=2xx': 1000,
        'status_class=5xx': 50,
      });
      const cur = snapshotWithHttp({
        'status_class=2xx': 1100, // augmente
        'status_class=5xx': 55, // augmente
      });
      expect(detectedRestart(prev, cur)).toBe(false);
    });

    it('ne détecte pas de restart avec snapshots vides', () => {
      const prev = makeSnapshot();
      const cur = makeSnapshot();
      expect(detectedRestart(prev, cur)).toBe(false);
    });
  });

  // ── evaluateAlerts ───────────────────────────────────────

  describe('evaluateAlerts', () => {
    it('marque baselineReset=true au premier run (pas de snapshot précédent)', async () => {
      const cur = snapshotWithHttp({ 'status_class=2xx': 100 });
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: null,
        curSnapshot: cur,
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      expect(result.baselineReset).toBe(true);
      // Aucune alerte rate-based ne doit se déclencher sans baseline
      const rateAlerts = result.alerts.filter(
        (a) => a.kind === 'error_rate_high' || a.kind === 'connect_5xx_rate_high',
      );
      for (const a of rateAlerts) {
        expect(a.triggered).toBe(false);
      }
    });

    it('déclenche error_rate_high quand le taux 5xx global > 1%', async () => {
      const prev = snapshotWithHttp({
        'status_class=2xx': 1000,
        'status_class=4xx': 50,
        'status_class=5xx': 5,
      });
      const cur = snapshotWithHttp({
        'status_class=2xx': 1100,
        'status_class=4xx': 60,
        'status_class=5xx': 20, // delta 5xx = 15, delta total = 125, rate = 12% > 1%
      });
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: prev,
        curSnapshot: cur,
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      const errorAlert = result.alerts.find((a) => a.kind === 'error_rate_high');
      expect(errorAlert?.triggered).toBe(true);
      expect(errorAlert?.suppressed).toBe(false);
      expect(cooldown.fired).toContainEqual({ kind: 'error_rate_high', id: 'global' });
    });

    it('ne déclenche pas error_rate_high quand le taux 5xx < 1%', async () => {
      const prev = snapshotWithHttp({
        'status_class=2xx': 1000,
        'status_class=5xx': 5,
      });
      const cur = snapshotWithHttp({
        'status_class=2xx': 2000,
        'status_class=5xx': 10, // delta 5xx = 5, delta total = 1005, rate ≈ 0.5% < 1%
      });
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: prev,
        curSnapshot: cur,
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      const errorAlert = result.alerts.find((a) => a.kind === 'error_rate_high');
      expect(errorAlert?.triggered).toBe(false);
    });

    it('déclenche connect_queue_backlog quand queueLength >= 1000', async () => {
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: null,
        curSnapshot: makeSnapshot(),
        queueLength: 1500,
        cooldown,
        windowMin: 5,
      });

      const queueAlert = result.alerts.find((a) => a.kind === 'connect_queue_backlog');
      expect(queueAlert?.triggered).toBe(true);
      expect(cooldown.fired).toContainEqual({
        kind: 'connect_queue_backlog',
        id: 'connect-analytics',
      });
    });

    it('ne déclenche pas connect_queue_backlog quand queueLength < 1000', async () => {
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: null,
        curSnapshot: makeSnapshot(),
        queueLength: 500,
        cooldown,
        windowMin: 5,
      });

      const queueAlert = result.alerts.find((a) => a.kind === 'connect_queue_backlog');
      expect(queueAlert?.triggered).toBe(false);
    });

    it('ne déclenche pas connect_queue_backlog quand queueLength est null (échec)', async () => {
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: null,
        curSnapshot: makeSnapshot(),
        queueLength: null,
        cooldown,
        windowMin: 5,
      });

      const queueAlert = result.alerts.find((a) => a.kind === 'connect_queue_backlog');
      expect(queueAlert?.triggered).toBe(false);
      expect(queueAlert?.detail.queueLength).toBeNull();
    });

    it("supprime l'alerte si le cooldown est actif", async () => {
      const prev = snapshotWithHttp({
        'status_class=2xx': 1000,
        'status_class=5xx': 5,
      });
      const cur = snapshotWithHttp({
        'status_class=2xx': 1100,
        'status_class=5xx': 20, // rate > 1%
      });
      const cooldown = makeMockCooldown();
      cooldown.suppressSet.add('error_rate_high:global');

      const result = await evaluateAlerts({
        prevSnapshot: prev,
        curSnapshot: cur,
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      const errorAlert = result.alerts.find((a) => a.kind === 'error_rate_high');
      expect(errorAlert?.triggered).toBe(true);
      expect(errorAlert?.suppressed).toBe(true);
      // markFired ne doit pas être appelé à nouveau
      expect(cooldown.fired).not.toContainEqual({ kind: 'error_rate_high', id: 'global' });
    });

    it('déclenche connect_latency_high quand p95 >= 500ms', async () => {
      // Construit des snapshots avec des buckets pour la route "availability"
      // 100 observations : 80 ≤ 250ms, 20 entre 500ms et 1000ms
      // p95 = 95e observation → dans le bucket [500, 1000]
      // 95 - 80 (cumulatif à le=500) = 15 dans le bucket
      // bucket [500,1000] a 20 observations (80 à 100)
      // fraction = 15/20 = 0.75
      // p95 = 500 + 0.75 * (1000 - 500) = 500 + 375 = 875
      const routeKey = 'route=availability,status=2xx';
      const prevBuckets: Record<string, Record<string, number>> = {};
      prevBuckets[routeKey] = {
        '5': 0,
        '10': 0,
        '25': 0,
        '50': 0,
        '100': 0,
        '250': 0,
        '500': 0,
        '1000': 0,
        '2500': 0,
        '5000': 0,
        '+Inf': 0,
      };
      const curBuckets: Record<string, Record<string, number>> = {};
      curBuckets[routeKey] = {
        '5': 0,
        '10': 0,
        '25': 0,
        '50': 0,
        '100': 0,
        '250': 80,
        '500': 80,
        '1000': 100,
        '2500': 100,
        '5000': 100,
        '+Inf': 100,
      };

      const prev = snapshotWithHttp({}, {}, prevBuckets);
      const cur = snapshotWithHttp({}, {}, curBuckets);
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: prev,
        curSnapshot: cur,
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      const latencyAlert = result.alerts.find(
        (a) => a.kind === 'connect_latency_high' && a.detail.route === 'availability',
      );
      expect(latencyAlert?.triggered).toBe(true);
      expect(latencyAlert?.detail.p95Ms).toBe(875);
    });

    it('détecte un restart et skip les alertes rate-based', async () => {
      const prev = snapshotWithHttp({
        'status_class=2xx': 10000,
        'status_class=5xx': 500,
      });
      const cur = snapshotWithHttp({
        'status_class=2xx': 5, // << 10000 → restart
        'status_class=5xx': 0, // << 500 → restart
      });
      const cooldown = makeMockCooldown();

      const result = await evaluateAlerts({
        prevSnapshot: prev,
        curSnapshot: cur,
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      expect(result.baselineReset).toBe(true);
      // Aucune alerte rate-based ne doit se déclencher
      const errorAlert = result.alerts.find((a) => a.kind === 'error_rate_high');
      expect(errorAlert?.triggered).toBe(false);
      expect(errorAlert?.detail.baselineReset).toBe(true);
    });

    it("capture les erreurs individuelles sans planter l'évaluation", async () => {
      const cooldown = makeMockCooldown();
      // Snapshot malformé — pas d'erreur car evaluateAlerts catch par alerte

      const result = await evaluateAlerts({
        prevSnapshot: null,
        curSnapshot: makeSnapshot(),
        queueLength: 0,
        cooldown,
        windowMin: 5,
      });

      // Même avec un snapshot vide, l'évaluation ne doit pas planter
      expect(result.errors).toHaveLength(0);
      expect(result.alerts.length).toBeGreaterThan(0);
    });
  });

  // ── captureSnapshot (integration avec prom-client) ───────

  describe('captureSnapshot', () => {
    it('capture les valeurs actuelles des métriques en mémoire', async () => {
      // Incrémente quelques counters
      httpRequestsTotal.inc({ status_class: '2xx' });
      httpRequestsTotal.inc({ status_class: '2xx' });
      httpRequestsTotal.inc({ status_class: '5xx' });

      connectRequestDuration.observe({ route: 'availability', status: '2xx' }, 50);
      connectRequestDuration.observe({ route: 'availability', status: '2xx' }, 150);

      const snapshot = await captureSnapshot();

      expect(snapshot.counters.httpRequests['status_class=2xx']).toBe(2);
      expect(snapshot.counters.httpRequests['status_class=5xx']).toBe(1);
      expect(snapshot.counters.connectRequestCount['route=availability,status=2xx']).toBe(2);
      // Les buckets doivent être présents
      const buckets = snapshot.histograms.connectRequestBuckets['route=availability,status=2xx'];
      expect(buckets).toBeDefined();
      expect(buckets['+Inf']).toBe(2);
    });
  });
});
