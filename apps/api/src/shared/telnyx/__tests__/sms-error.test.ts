import { describe, expect, it } from 'vitest';
import { sanitizeSmsProviderError } from '../sms-error';
import { classifyNotificationError } from '../../queue/notification-idempotency';

describe('SMS provider diagnostic sanitization', () => {
  it('exposes HTTP status and SDK responseBody error codes instead of null', () => {
    const source = Object.assign(new Error('null'), {
      type: 'TelnyxInvalidRequestError',
      statusCode: 400,
      raw: { responseBody: { errors: [{ code: '40305', detail: 'private recipient' }] } },
    });
    const safe = sanitizeSmsProviderError(source);
    expect(safe.message).toBe('Telnyx SMS send failed (HTTP 400, 40305)');
    expect(classifyNotificationError(safe)).toBe('failure_certain');
  });

  it('never copies raw payloads, headers, messages, details or causes', () => {
    const marker = 'PRIVATE_CUSTOMER_AND_SECRET';
    const safe = sanitizeSmsProviderError(
      Object.assign(new Error(marker), {
        statusCode: 400,
        code: '40305',
        detail: marker,
        headers: { authorization: marker },
        requestId: marker,
        cause: new Error(marker),
        responseBody: { errors: [{ code: '40305', detail: marker, title: marker }] },
        raw: { message: marker },
      }),
    );
    expect(JSON.stringify(safe)).not.toContain(marker);
    expect(safe.stack).not.toContain(marker);
    expect(safe).not.toHaveProperty('cause');
    expect(safe).not.toHaveProperty('raw');
    expect(safe.message).toBe('Telnyx SMS send failed (HTTP 400, 40305)');
  });

  it('filters arbitrary provider code strings and deduplicates codes', () => {
    const safe = sanitizeSmsProviderError({
      code: '40305',
      responseBody: {
        errors: [
          { code: 40305 },
          { code: 'private@example.invalid' },
          { code: '+33600000000' },
          { code: '10004' },
        ],
      },
    });
    expect(safe).toHaveProperty('providerErrorCodes', ['40305', '10004']);
    expect(safe.message).not.toContain('private');
    expect(safe.message).not.toContain('+336');
  });

  it.each([
    { statusCode: 408 },
    { statusCode: 500 },
    { statusCode: 503 },
    { code: 'ETIMEDOUT' },
    { code: 'ECONNRESET' },
    new Error('Network request failed'),
    null,
  ])('preserves ambiguity without permitting a blind retry (%j)', (source) => {
    expect(classifyNotificationError(sanitizeSmsProviderError(source))).toBe('unknown');
  });

  it('preserves explicit provider refusal classification', () => {
    const safe = sanitizeSmsProviderError({
      statusCode: 400,
      notificationResult: 'failure_certain',
    });
    expect(classifyNotificationError(safe)).toBe('failure_certain');
  });
});
