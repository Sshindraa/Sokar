import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn(async (_payload: unknown) => ({ data: { id: 'msg_test_1' }, error: null }));
const getMock = vi.fn(async () => ({ data: { last_event: 'delivered' }, error: null }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock, get: getMock };
  },
}));

import { lookupResendEmail, sendEmail } from '../index';
import { waitForResendSlot } from '../rate-limit';

const MESSAGE = { subject: 'Test', html: '<p>Bonjour</p>' };

describe('sendEmail : liste de destinataires de test (EMAIL_TEST_ALLOWLIST)', () => {
  beforeEach(() => {
    sendMock.mockClear();
    getMock.mockClear();
    vi.mocked(waitForResendSlot).mockReset().mockResolvedValue(undefined);
    vi.stubEnv('RESEND_API_KEY', 'unit-test-placeholder');
    vi.stubEnv('EMAIL_FROM', 'noreply@sokar.tech');
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('envoie sans restriction quand la liste n’est pas définie', async () => {
    await sendEmail({ to: 'client@example.com', ...MESSAGE });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('envoie au destinataire autorisé, sans tenir compte de la casse', async () => {
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', 'hamza@sokar.tech');

    await sendEmail({ to: 'Hamza@Sokar.tech', ...MESSAGE });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('refuse tout autre destinataire sans appeler Resend', async () => {
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', 'hamza@sokar.tech');

    const result = await sendEmail({ to: 'client@example.com', ...MESSAGE });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: 'failure_certain',
      provider: 'resend',
      channel: 'email',
    });
  });

  it('ne contacte pas Resend si le limiteur refuse la requête', async () => {
    vi.mocked(waitForResendSlot).mockRejectedValue(new Error('Admission refused'));
    await expect(sendEmail({ to: 'client@example.com', ...MESSAGE })).rejects.toThrow(
      'Admission refused',
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('régule aussi les lectures fournisseur et conserve leur résultat inconnu si refusées', async () => {
    vi.mocked(waitForResendSlot).mockRejectedValue(new Error('Admission refused'));
    expect(await lookupResendEmail('message-reference')).toBe('unknown');
    expect(getMock).not.toHaveBeenCalled();
  });
});
