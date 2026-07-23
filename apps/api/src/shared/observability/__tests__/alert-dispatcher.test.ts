import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAlert } from '../alert-dispatcher';
import { renderMetrics, alertsSentTotal } from '../metrics';
import { sendEmail } from '../../email';
import { sendSms } from '../../telnyx/client';

vi.mock('../../email', () => ({ sendEmail: vi.fn() }));
vi.mock('../../telnyx/client', () => ({ sendSms: vi.fn() }));
vi.mock('../../sentry/client', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
  closeSentry: vi.fn(),
  sentryEnabled: vi.fn(() => false),
}));

const ALERT_VARS = ['ALERT_EMAIL_TO', 'ALERT_WEBHOOK_URL', 'ALERT_SMS_TO'] as const;

describe('dispatchAlert', () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset().mockResolvedValue(undefined);
    vi.mocked(sendSms).mockReset().mockResolvedValue(undefined);
    alertsSentTotal.reset();
    for (const key of ALERT_VARS) delete process.env[key];
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const key of ALERT_VARS) delete process.env[key];
    vi.unstubAllGlobals();
  });

  it('sans canal configuré : ne throw pas, Sentry seul', async () => {
    const results = await dispatchAlert({
      kind: 'test_alert',
      severity: 'critical',
      summary: 'Résumé test',
      detail: 'Détail test',
    });

    expect(results).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('envoie un email quand ALERT_EMAIL_TO est défini', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@sokar.tech';

    const results = await dispatchAlert({
      kind: 'failed_jobs',
      severity: 'critical',
      summary: '5 jobs en échec',
      detail: 'file sms-client',
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe('ops@sokar.tech');
    expect(call.subject).toContain('CRITICAL');
    expect(call.subject).toContain('5 jobs en échec');
    expect(call.html).toContain('file sms-client');
    expect(results).toEqual([{ channel: 'email', ok: true }]);
  });

  it('envoie un webhook Slack-format quand ALERT_WEBHOOK_URL est défini', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const results = await dispatchAlert({
      kind: 'queue_backlog',
      severity: 'warning',
      summary: 'Backlog 150 jobs',
      detail: 'file analytics',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('Backlog 150 jobs');
    expect(body.text).toContain('file analytics');
    expect(results).toEqual([{ channel: 'webhook', ok: true }]);
  });

  it('SMS réservé aux critiques par défaut', async () => {
    process.env.ALERT_SMS_TO = '+33612345678';

    const warningResults = await dispatchAlert({
      kind: 'queue_backlog',
      severity: 'warning',
      summary: 'Backlog',
      detail: 'détail',
    });
    expect(sendSms).not.toHaveBeenCalled();
    expect(warningResults).toHaveLength(0);

    const criticalResults = await dispatchAlert({
      kind: 'queue_unreachable',
      severity: 'critical',
      summary: 'Redis inaccessible',
      detail: 'détail',
    });
    expect(sendSms).toHaveBeenCalledOnce();
    expect(vi.mocked(sendSms).mock.calls[0][0]).toBe('+33612345678');
    expect(criticalResults).toEqual([{ channel: 'sms', ok: true }]);
  });

  it('sms: false bloque le SMS même en critique', async () => {
    process.env.ALERT_SMS_TO = '+33612345678';

    await dispatchAlert({
      kind: 'reservations_without_sms',
      severity: 'critical',
      summary: 'Résa sans SMS',
      detail: 'détail',
      sms: false,
    });

    expect(sendSms).not.toHaveBeenCalled();
  });

  it('un canal en échec ne throw pas et est marqué ko', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@sokar.tech';
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test';
    vi.mocked(sendEmail).mockRejectedValue(new Error('SMTP down'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const results = await dispatchAlert({
      kind: 'failed_jobs',
      severity: 'critical',
      summary: 'Test',
      detail: 'détail',
    });

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.channel === 'email')).toMatchObject({
      ok: false,
      error: 'SMTP down',
    });
    expect(results.find((r) => r.channel === 'webhook')).toMatchObject({
      ok: false,
      error: 'HTTP 500',
    });
  });

  it('compte les envois dans sokar_alerts_sent_total', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@sokar.tech';

    await dispatchAlert({
      kind: 'failed_jobs',
      severity: 'critical',
      summary: 'Test',
      detail: 'détail',
    });

    const payload = await renderMetrics();
    expect(payload).toMatch(
      /sokar_alerts_sent_total\{[^}]*channel="email"[^}]*result="ok"[^}]*\} 1/,
    );
    expect(payload).toMatch(
      /sokar_alerts_sent_total\{[^}]*channel="sentry"[^}]*result="ok"[^}]*\} 1/,
    );
  });
});
