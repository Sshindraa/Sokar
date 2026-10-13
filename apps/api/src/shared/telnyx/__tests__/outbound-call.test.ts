import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOutboundCallParams } from '../client';

const ENV_KEYS = ['TELNYX_FROM_NUMBER', 'TELNYX_CONNECTION_ID'] as const;
const WEBHOOK = 'https://api-staging.sokar.tech/voice/telnyx';

describe('buildOutboundCallParams', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.TELNYX_FROM_NUMBER = '+33100000000';
    process.env.TELNYX_CONNECTION_ID = '2000000000000001';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('utilise le connectionId transmis par l’appelant', () => {
    const params = buildOutboundCallParams('+33612345678', {
      webhookUrl: WEBHOOK,
      connectionId: '3000000000000002',
    });

    expect(params.connection_id).toBe('3000000000000002');
  });

  it('retombe sur TELNYX_CONNECTION_ID quand l’appelant n’en transmet pas', () => {
    const params = buildOutboundCallParams('+33612345678', { webhookUrl: WEBHOOK });

    expect(params.connection_id).toBe('2000000000000001');
  });

  it('refuse explicitement un appel sans application d’appel', () => {
    delete process.env.TELNYX_CONNECTION_ID;

    expect(() => buildOutboundCallParams('+33612345678', { webhookUrl: WEBHOOK })).toThrow(
      'TELNYX_CONNECTION_ID',
    );
  });

  it('refuse explicitement un appel sans numéro émetteur', () => {
    delete process.env.TELNYX_FROM_NUMBER;

    expect(() => buildOutboundCallParams('+33612345678', { webhookUrl: WEBHOOK })).toThrow(
      'TELNYX_FROM_NUMBER',
    );
  });

  it('transmet le webhook HTTP et l’état client encodé en base64', () => {
    const params = buildOutboundCallParams('+33612345678', {
      webhookUrl: WEBHOOK,
      clientState: { kind: 'onboarding_test_call', restaurantId: 'r1' },
      timeoutSecs: 30,
    });

    expect(params.to).toBe('+33612345678');
    expect(params.from).toBe('+33100000000');
    expect(params.webhook_url).toBe(WEBHOOK);
    expect(params.webhook_url_method).toBe('POST');
    expect(params.timeout).toBe(30);
    expect(
      JSON.parse(Buffer.from(params.client_state as string, 'base64').toString('utf8')),
    ).toEqual({ kind: 'onboarding_test_call', restaurantId: 'r1' });
  });
});
