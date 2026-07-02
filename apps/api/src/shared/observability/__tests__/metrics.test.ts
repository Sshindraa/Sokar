import { describe, expect, it, beforeEach } from 'vitest';
import { renderMetrics, piiLeaksTotal, openaiReserveFeedRequestsTotal } from '../metrics';

describe('Prometheus metrics', () => {
  beforeEach(() => {
    // Reset les valeurs sans recréer le registry (les compteurs sont
    // attachés au registry au top-level).
    piiLeaksTotal.reset();
    openaiReserveFeedRequestsTotal.reset();
  });

  it('incrémente un counter et expose le label', async () => {
    piiLeaksTotal.inc({ kind: 'email' });
    piiLeaksTotal.inc({ kind: 'email' });
    piiLeaksTotal.inc({ kind: 'phone' });
    const payload = await renderMetrics();
    expect(payload).toContain('sokar_agentic_pii_leaks_total');
    expect(payload).toMatch(/sokar_agentic_pii_leaks_total\{[^}]*kind="email"[^}]*\} 2/);
    expect(payload).toMatch(/sokar_agentic_pii_leaks_total\{[^}]*kind="phone"[^}]*\} 1/);
  });

  it('expose les métriques par défaut nodejs', async () => {
    const payload = await renderMetrics();
    // Métriques par défaut prom-client (collectDefaultMetrics)
    expect(payload).toContain('process_cpu_user_seconds_total');
  });

  it('expose sokar_openai_reserve_feed_requests_total avec labels status', async () => {
    openaiReserveFeedRequestsTotal.inc({ status: '200' });
    openaiReserveFeedRequestsTotal.inc({ status: '200' });
    openaiReserveFeedRequestsTotal.inc({ status: '429' });
    const payload = await renderMetrics();
    expect(payload).toContain('sokar_openai_reserve_feed_requests_total');
    expect(payload).toMatch(/sokar_openai_reserve_feed_requests_total\{[^}]*status="200"[^}]*\} 2/);
    expect(payload).toMatch(/sokar_openai_reserve_feed_requests_total\{[^}]*status="429"[^}]*\} 1/);
  });
});
