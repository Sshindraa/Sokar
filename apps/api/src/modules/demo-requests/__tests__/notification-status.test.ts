import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Réponse brute du SDK Resend : succès ({ data }) ou erreur ({ error }), typée large pour couvrir les deux cas.
const sendMock = vi.fn<(payload: unknown) => Promise<unknown>>(async () => ({
  data: { id: 'msg_test_1' },
  error: null,
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { notifyDemoRequest } from '../demo-request.service';

const RECORD = {
  id: 'dr_1',
  establishmentName: 'Bistrot Test',
  contactEmail: 'contact@example.test',
  contactPhone: null,
} as const;

describe('notifyDemoRequest : statut de notification', () => {
  beforeEach(() => {
    sendMock.mockClear();
    vi.stubEnv('RESEND_API_KEY', 'unit-test-placeholder');
    vi.stubEnv('EMAIL_FROM', 'noreply@sokar.tech');
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('retourne true quand le destinataire autorisé accepte l’envoi', async () => {
    vi.stubEnv('DEMO_REQUEST_NOTIFY_TO', 'hamza@sokar.tech');
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', 'hamza@sokar.tech');

    await expect(notifyDemoRequest(RECORD)).resolves.toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('ne transmet pas les coordonnées ni le contenu de la demande au fournisseur e-mail', async () => {
    vi.stubEnv('DEMO_REQUEST_NOTIFY_TO', 'ops@example.test');
    vi.stubEnv('DASHBOARD_URL', 'https://staging.sokar.tech');
    const record = {
      ...RECORD,
      contactPhone: '+33****0000',
      currentTool: 'outil-confidentiel-test',
      mainProblem: 'besoin-confidentiel-test',
    };

    await expect(notifyDemoRequest(record)).resolves.toBe(true);
    expect(sendMock).toHaveBeenCalledWith({
      from: 'Sokar <noreply@sokar.tech>',
      replyTo: 'hello@sokar.tech',
      to: 'ops@example.test',
      subject: 'Nouvelle demande de démonstration Sokar',
      html: expect.stringContaining('https://staging.sokar.tech/admin/demo-requests'),
    });
    const payload = JSON.stringify(sendMock.mock.calls[0][0]);
    expect(payload).toContain(RECORD.id);
    for (const value of [
      record.establishmentName,
      record.contactEmail,
      record.contactPhone,
      record.currentTool,
      record.mainProblem,
    ]) {
      expect(payload).not.toContain(value);
    }
  });

  it('échappe la référence et ne place ni identifiant ni jeton d’accès dans le lien', async () => {
    vi.stubEnv('DEMO_REQUEST_NOTIFY_TO', 'ops@example.test');
    vi.stubEnv('DASHBOARD_URL', 'https://staging.sokar.tech/');

    await expect(notifyDemoRequest({ id: '<script>test</script>' })).resolves.toBe(true);
    const payload = sendMock.mock.calls[0][0] as { html: string };
    expect(payload.html).toContain('&lt;script&gt;test&lt;/script&gt;');
    expect(payload.html).not.toContain('<script>');
    expect(payload.html).toContain('href="https://staging.sokar.tech/admin/demo-requests"');
    expect(payload.html).not.toMatch(/\?|token=|mailto:|tel:/);
  });

  it('retourne false sans appeler Resend quand le destinataire est bloqué', async () => {
    vi.stubEnv('DEMO_REQUEST_NOTIFY_TO', 'client@example.test');
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', 'hamza@sokar.tech');

    await expect(notifyDemoRequest(RECORD)).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('retourne false quand un des destinataires échoue, en tentant quand même les autres', async () => {
    vi.stubEnv('DEMO_REQUEST_NOTIFY_TO', 'a@sokar.tech,b@sokar.tech');
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: 'application_error', message: 'provider unavailable' },
    });
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_test_2' }, error: null });

    await expect(notifyDemoRequest(RECORD)).resolves.toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('retourne false quand un destinataire lève une exception, sans interrompre les suivants', async () => {
    vi.stubEnv('DEMO_REQUEST_NOTIFY_TO', 'a@sokar.tech,b@sokar.tech');
    sendMock.mockRejectedValueOnce(new Error('network down'));
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_test_3' }, error: null });

    await expect(notifyDemoRequest(RECORD)).resolves.toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
