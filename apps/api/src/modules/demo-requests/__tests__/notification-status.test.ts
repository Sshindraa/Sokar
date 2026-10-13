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
