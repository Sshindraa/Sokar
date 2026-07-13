/**
 * Tests for the Telnyx SMS inbound webhook.
 *
 * Telnyx envoie un body de la forme :
 *   { data: { event_type: 'message.received', payload: { from, text } } }
 *
 * Le parsing OUI/NON est délégué à handleReply (partagé avec WhatsApp).
 * Le preHandler telnyxWebhookGuard (signature Ed25519) est mocké — il
 * est testé séparément dans telnyx.guard.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Bypass Ed25519 signature verification — covered in telnyx.guard.test.ts.
vi.mock('../../voice/telnyx.guard', () => ({
  telnyxWebhookGuard: vi.fn(async (_req: FastifyRequest, _reply: FastifyReply) => undefined),
}));

// Mock the reply handler so we can assert what was parsed and dispatched.
vi.mock('../reply-handler', () => ({
  handleReply: vi.fn().mockResolvedValue({
    intent: 'CONFIRMED',
    reservationId: 'res-1',
    action: 'confirmed',
  }),
}));

import { getApp, closeApp } from '../../../test/helpers';
import { handleReply } from '../reply-handler';

const mockHandleReply = vi.mocked(handleReply);

const VALID_BODY = {
  data: {
    event_type: 'message.received',
    payload: {
      from: { phone_number: '+336****5678' },
      text: 'OUI',
    },
  },
};

describe('POST /sms/telnyx/inbound', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('renvoie 200 et dispatche handleReply pour un message.received', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ok' });
    expect(mockHandleReply).toHaveBeenCalledWith('+336****5678', 'OUI', 'sms');
  });

  it('ignore les events non-message.received (statuts, etc.)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: { event_type: 'message.sent', payload: { from: { phone_number: '+33' } } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ignored' });
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it("renvoie ok sans dispatcher si 'from' est manquant", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { from: undefined, text: 'OUI' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ok' });
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it("renvoie ok sans dispatcher si 'text' est manquant", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { from: { phone_number: '+336****5678' } },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it('supporte from en string (et pas seulement en objet {phone_number})', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { from: '+336****1234', text: 'NON' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).toHaveBeenCalledWith('+336****1234', 'NON', 'sms');
  });
});
