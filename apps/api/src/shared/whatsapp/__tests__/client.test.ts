import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../telnyx/client', () => ({ lookupTelnyxMessage: vi.fn() }));
vi.mock('../../../modules/usage/messaging-usage.service', () => ({
  recordAcceptedMessagingUsage: vi.fn(),
}));

describe('WhatsApp template transport', () => {
  const request = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', request);
    vi.stubEnv('TELNYX_API_KEY', randomUUID());
    vi.stubEnv('TELNYX_FROM_NUMBER', 'voice-sender');
    vi.stubEnv('TELNYX_WHATSAPP_FROM', 'whatsapp-sender');
    vi.stubEnv('WHATSAPP_ENABLED', 'true');
    vi.stubEnv('WHATSAPP_PROVIDER', 'telnyx');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the dedicated sender and the supported HTTP endpoint once', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'message-1' } })));
    const { isWhatsAppConfigured, sendWhatsAppTemplate } = await import('../client');
    expect(isWhatsAppConfigured()).toBe(true);
    expect(
      await sendWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', ['Restaurant']),
    ).toMatchObject({ outcome: 'success', providerMessageId: 'message-1' });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api.telnyx.com/v2/messages/whatsapp');
    expect(JSON.parse(options.body)).toMatchObject({
      from: 'whatsapp-sender',
      whatsapp_message: { type: 'template', template: { name: 'reservation_reminder' } },
    });
  });

  it('does not fall back to the voice sender when WhatsApp sender is missing', async () => {
    vi.stubEnv('TELNYX_WHATSAPP_FROM', '');
    const { isWhatsAppConfigured, sendWhatsAppTemplate } = await import('../client');
    expect(isWhatsAppConfigured()).toBe(false);
    await expect(
      sendWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []),
    ).rejects.toThrow('required');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps configuration disabled without the feature flag', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', 'false');
    const { isWhatsAppConfigured } = await import('../client');
    expect(isWhatsAppConfigured()).toBe(false);
  });

  it('treats a successful response without message id as unknown', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    const { sendWhatsAppTemplate } = await import('../client');
    expect(await sendWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', [])).toMatchObject(
      { outcome: 'unknown' },
    );
  });

  it.each([400, 429, 503])(
    'preserves HTTP status %s without exposing the provider body',
    async (status) => {
      request.mockResolvedValue(new Response('private-provider-body', { status }));
      const { sendWhatsAppTemplate } = await import('../client');
      await expect(
        sendWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []),
      ).rejects.toMatchObject({ statusCode: status, message: 'WhatsApp provider request failed' });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry an ambiguous network failure', async () => {
    request.mockRejectedValue(new TypeError('network failure'));
    const { sendWhatsAppTemplate } = await import('../client');
    await expect(
      sendWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []),
    ).rejects.toThrow('network failure');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
