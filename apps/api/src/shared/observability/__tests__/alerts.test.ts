import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertDoubleBooking,
  alertPiiLeak,
  alertErrorRateHigh,
  alertAgentUnavailable,
} from '../alerts';
import { piiLeaksTotal, renderMetrics } from '../metrics';

// Mocks minimaux pour Sentry et metrics
vi.mock('../../sentry/client', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('Alerts service', () => {
  beforeEach(() => {
    piiLeaksTotal.reset();
  });

  it('alertDoubleBooking ne throw pas et incrémente le compteur', () => {
    expect(() =>
      alertDoubleBooking({
        restaurantId: 'r-1',
        partySize: 4,
        slotStart: '2026-12-01T19:00:00Z',
        attemptedBy: 'test',
      }),
    ).not.toThrow();
  });

  it('alertPiiLeak ne throw pas et incrémente le compteur', async () => {
    expect(() =>
      alertPiiLeak({
        tool: 'get_restaurant_details',
        kind: 'phone',
        path: 'data.phone',
        sample: '+33****0000',
      }),
    ).not.toThrow();

    const payload = await renderMetrics();
    expect(payload).toMatch(/sokar_agentic_pii_leaks_total\{[^}]*kind="phone"[^}]*\} 1/);
  });

  it('alertErrorRateHigh alerte seulement au-dessus de 1%', () => {
    // En dessous de 1% : ne devrait pas alerter
    expect(() => alertErrorRateHigh({ rate5xx: 0.005, windowMin: 5 })).not.toThrow();
    // Au-dessus de 1% : alerte
    expect(() => alertErrorRateHigh({ rate5xx: 0.05, windowMin: 5 })).not.toThrow();
  });

  it('alertAgentUnavailable ne throw pas', () => {
    expect(() => alertAgentUnavailable({ agent: 'claude', reason: 'rate_limited' })).not.toThrow();
  });
});
