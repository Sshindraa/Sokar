/**
 * Tests for the Telnyx WhatsApp inbound webhook.
 *
 * Mêmes garanties que le webhook SMS (parsing OUI/NON partagé via
 * reply-handler.handleReply). Le webhook est protégé par telnyxWebhookGuard
 * (signature Telnyx), mocké dans ces tests.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../voice/telnyx.guard', () => ({
  telnyxWebhookGuard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../sms/reply-handler', () => ({
  handleReply: vi.fn().mockResolvedValue({
    intent: 'CONFIRMED',
    reservationId: 'res-1',
    action: 'confirmed',
  }),
}));

import { getApp, closeApp } from '../../../test/helpers';
import { handleReply } from '../../sms/reply-handler';

const mockHandleReply = vi.mocked(handleReply);

describe('POST /whatsapp/webhook', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('renvoie 200 et dispatche handleReply avec channel=whatsapp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { from: '+336****5678', text: 'OUI' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ok' });
    expect(mockHandleReply).toHaveBeenCalledWith('+336****5678', 'OUI', 'whatsapp');
  });

  it('ignore les events de statut (sent, delivered, etc.)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: { event_type: 'message.delivered' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ok' });
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it('ignore si payload manquant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: { data: { event_type: 'message.received' } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it("renvoie ok sans dispatcher si 'from' est manquant", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { text: 'OUI' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it("renvoie ok sans dispatcher si 'text' est manquant", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { from: '+336****5678' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it('supporte from en objet {phone_number}', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { from: { phone_number: '+336****9999' }, text: 'NON' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).toHaveBeenCalledWith('+336****9999', 'NON', 'whatsapp');
  });
});
