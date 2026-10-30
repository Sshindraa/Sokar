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
import { queues } from '../../../shared/queue/queues';
import { handleReply } from '../reply-handler';

const mockHandleReply = vi.mocked(handleReply);

const VALID_BODY = {
  data: {
    event_type: 'message.received',
    payload: {
      id: 'message-1',
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

  it('bloque une réponse dont la réservation ne peut pas être identifiée', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ok' });
    expect(mockHandleReply).not.toHaveBeenCalled();
    expect(queues.deadLetter.add).toHaveBeenCalledWith(
      'inbound-reply-review',
      expect.objectContaining({
        payloadVersion: 0,
        data: null,
        originalQueue: 'inbound-reply-review',
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^inbound_reply_review_[0-9a-f]{64}$/),
      }),
    );
    const saved = JSON.stringify(vi.mocked(queues.deadLetter.add).mock.calls[0][1]);
    expect(saved).not.toContain('+336****5678');
    expect(saved).not.toContain('OUI');
  });

  it('ne confirme pas la réception sans identifiant fiable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: { event_type: 'message.received', payload: { from: 'sender', text: 'NON' } },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(mockHandleReply).not.toHaveBeenCalled();
    expect(queues.deadLetter.add).not.toHaveBeenCalled();
  });

  it('renvoie une erreur si la file de revue est indisponible', async () => {
    vi.mocked(queues.deadLetter.add).mockRejectedValueOnce(new Error('queue unavailable'));
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(503);
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it('accuse réception des événements de statut sans dispatcher de réponse client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.finalized',
          payload: {
            id: 'msg-1',
            to: [{ phone_number: '+336****5678', status: 'delivered' }],
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ignored' });
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it('trace une livraison SMS échouée et répond rapidement à Telnyx', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.finalized',
          payload: {
            id: 'msg-2',
            to: [{ phone_number: '+336****5678', status: 'delivery_failed' }],
            errors: [{ code: '40305' }],
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ignored' });
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it("conserve une référence pour la revue si 'from' est manquant", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { id: 'message-missing-from', from: undefined, text: 'OUI' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: 'ok' });
    expect(mockHandleReply).not.toHaveBeenCalled();
    expect(queues.deadLetter.add).toHaveBeenCalledOnce();
  });

  it("conserve une référence pour la revue si 'text' est manquant", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { id: 'message-missing-text', from: { phone_number: '+336****5678' } },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
    expect(queues.deadLetter.add).toHaveBeenCalledOnce();
  });

  it('supporte from en string (et pas seulement en objet {phone_number})', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sms/telnyx/inbound',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { id: 'message-2', from: '+336****1234', text: 'NON' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
    expect(queues.deadLetter.add).toHaveBeenCalledOnce();
  });
});
