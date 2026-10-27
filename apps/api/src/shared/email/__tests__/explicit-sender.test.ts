import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn(async (_payload: unknown) => ({ data: { id: 'msg_test_1' }, error: null }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendEmail } from '../index';
import { waitForResendSlot } from '../rate-limit';

const MESSAGE = { to: 'client@example.com', subject: 'Test', html: '<p>Bonjour</p>' };

describe('sendEmail : expéditeur et Reply-To explicites', () => {
  beforeEach(() => {
    sendMock.mockClear();
    vi.mocked(waitForResendSlot).mockReset().mockResolvedValue(undefined);
    vi.stubEnv('RESEND_API_KEY', 'unit-test-placeholder');
    vi.stubEnv('EMAIL_FROM', 'noreply@sokar.tech');
    vi.stubEnv('EMAIL_REPLY_TO', '');
    vi.stubEnv('EMAIL_TEST_ALLOWLIST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('garde EMAIL_FROM et la boîte de réponse par défaut quand rien n’est fourni', async () => {
    await sendEmail(MESSAGE);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Sokar <noreply@sokar.tech>', replyTo: 'hello@sokar.tech' }),
    );
  });

  it('utilise l’expéditeur et le Reply-To fournis, sans revenir à EMAIL_FROM', async () => {
    await sendEmail({
      ...MESSAGE,
      from: '"Chez Sokar" <bonjour@news.sokar.test>',
      replyTo: 'manager@chez-sokar.test',
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Chez Sokar" <bonjour@news.sokar.test>',
        replyTo: 'manager@chez-sokar.test',
      }),
    );
  });

  it('n’envoie aucun Reply-To quand il est explicitement absent', async () => {
    await sendEmail({ ...MESSAGE, from: '"Chez Sokar" <bonjour@news.sokar.test>', replyTo: null });

    expect(sendMock.mock.calls[0]?.[0]).not.toHaveProperty('replyTo');
  });
});
