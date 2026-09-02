import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetMetrics,
  renderMetrics,
  recordNotificationClaimEvent,
  piiLeaksTotal,
  openaiReserveFeedRequestsTotal,
} from '../metrics';
import { observeReservationMutation } from '../reservation-contract';

describe('Prometheus metrics', () => {
  beforeEach(() => {
    // Reset les valeurs sans recréer le registry (les compteurs sont
    // attachés au registry au top-level).
    __resetMetrics();
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

  it('observe les contrats réservation avec des labels bornés et détecte PENDING/CONFIRMED', async () => {
    observeReservationMutation({
      source: 'connect',
      operation: 'create',
      status: 'CONFIRMED',
      state: 'PENDING',
      idempotency: 'keyed',
      audit: 'written',
      notification: 'not_sent',
      capacity: 'reserved',
    });

    const payload = await renderMetrics();
    expect(payload).toMatch(
      /sokar_reservation_mutations_total\{[^}]*source="connect"[^}]*operation="create"[^}]*\} 1/,
    );
    expect(payload).toMatch(
      /sokar_reservation_status_state_mismatches_total\{[^}]*source="connect"[^}]*operation="create"[^}]*mismatch_type="status_state_pending_projection"[^}]*\} 1/,
    );
    expect(payload).toContain('mismatch_type="idempotency_keyed"');
    expect(payload).toContain('mismatch_type="audit_written"');
    expect(payload).toContain('mismatch_type="capacity_reserved"');
  });

  it('n’expose aucun identifiant métier dans les labels du contrat', async () => {
    observeReservationMutation({
      source: 'voice',
      operation: 'create_replay',
      status: 'CONFIRMED',
      state: 'CONFIRMED',
      idempotency: 'reused',
      audit: 'not_applicable',
      notification: 'not_applicable',
      capacity: 'unchanged',
      mutated: false,
    });

    const payload = await renderMetrics();
    expect(payload).toContain('source="voice"');
    expect(payload).toContain('operation="create_replay"');
    expect(payload).not.toContain('reservation-should-not-be-a-label');
    expect(payload).not.toContain('restaurant-should-not-be-a-label');
  });

  it('expose les événements de claim avec une cardinalité fixe', async () => {
    recordNotificationClaimEvent('orphan_recovered');
    recordNotificationClaimEvent('queue_unavailable');

    const payload = await renderMetrics();
    expect(payload).toMatch(/sokar_notification_claim_events_total\{event="orphan_recovered"\} 1/);
    expect(payload).toMatch(/sokar_notification_claim_events_total\{event="queue_unavailable"\} 1/);
    expect(payload).not.toContain('reservation-should-not-be-a-label');
  });
});
