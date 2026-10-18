import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMetaWhatsAppConfigured, sendMetaWhatsAppTemplate } from '../meta-client';
import {
  classifyNotificationError,
  parseNotificationClaim,
} from '../../queue/notification-idempotency';

vi.mock('../../../modules/usage/messaging-usage.service', () => ({
  recordAcceptedMessagingUsage: vi.fn(),
}));

describe('Meta Cloud API transport', () => {
  const request = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', request);
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', randomUUID());
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123456');
    vi.stubEnv('META_WHATSAPP_GRAPH_VERSION', 'v25.0');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends one approved template with the Meta receipt format', async () => {
    request.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.example' }] })),
    );
    const result = await sendMetaWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', [
      'Restaurant',
    ]);
    expect(result).toEqual({
      provider: 'meta',
      channel: 'whatsapp',
      outcome: 'success',
      providerMessageId: 'wamid.example',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/123456/messages');
    expect(JSON.parse(options.body)).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      template: { name: 'reservation_reminder', language: { code: 'fr' } },
    });
  });

  it('does not make a request without a qualified configuration', async () => {
    vi.stubEnv('META_WHATSAPP_GRAPH_VERSION', '');
    expect(isMetaWhatsAppConfigured()).toBe(false);
    await expect(
      sendMetaWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []),
    ).rejects.toThrow('not configured');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps a missing message receipt unknown', async () => {
    request.mockResolvedValue(new Response('{}'));
    expect(
      await sendMetaWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []),
    ).toMatchObject({ outcome: 'unknown', provider: 'meta' });
  });

  it.each([400, 429, 503])('sanitizes HTTP %s without automatic retries', async (status) => {
    request.mockResolvedValue(new Response('private-body', { status }));
    try {
      await sendMetaWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ message: 'Meta WhatsApp request failed', statusCode: status });
      expect(classifyNotificationError(error)).toBe(status === 503 ? 'unknown' : 'failure_certain');
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('preserves Meta on an unknown claim across a provider switch', () => {
    expect(
      parseNotificationClaim(
        JSON.stringify({
          version: 1,
          status: 'unknown',
          provider: 'meta',
          channel: 'whatsapp',
          updatedAt: '',
          providerMessageId: 'wamid.example',
        }),
      ),
    ).toMatchObject({ provider: 'meta', status: 'unknown' });
  });

  it('keeps network failure unknown and sends only once', async () => {
    request.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      sendMetaWhatsAppTemplate('recipient', 'reservation_reminder', 'fr', []),
    ).rejects.toThrow('fetch failed');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
