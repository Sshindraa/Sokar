import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyResendWebhookSignature } from './index';

describe('verifyResendWebhookSignature', () => {
  const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email-1' } });
  const id = 'evt-1';
  const timestamp = '1789291200';
  const secret = `whsec_${Buffer.from('resend-test-secret').toString('base64')}`;

  function signature() {
    return createHmac('sha256', Buffer.from('resend-test-secret'))
      .update(`${id}.${timestamp}.${payload}`)
      .digest('base64');
  }

  it('accepte une signature Svix valide et refuse une altération', () => {
    const input = {
      payload,
      id,
      timestamp,
      signature: `v1,${signature()}`,
      secret,
      now: Number(timestamp) * 1000,
    };
    expect(verifyResendWebhookSignature(input)).toBe(true);
    expect(verifyResendWebhookSignature({ ...input, payload: `${payload} ` })).toBe(false);
  });

  it('refuse une signature expirée ou absente', () => {
    const valid = `v1,${signature()}`;
    expect(
      verifyResendWebhookSignature({
        payload,
        id,
        timestamp,
        signature: valid,
        secret,
        now: Number(timestamp) * 1000 + 301_000,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature({ payload, id, timestamp, signature: undefined, secret }),
    ).toBe(false);
  });
});
