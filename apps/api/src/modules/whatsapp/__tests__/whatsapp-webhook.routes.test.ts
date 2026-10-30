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
import { queues } from '../../../shared/queue/queues';
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

  it('bloque une réponse dont la réservation ne peut pas être identifiée', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { id: 'message-1', from: '+336****5678', text: 'OUI' },
        },
      },
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

  it('renvoie 503 si la file de revue est indisponible', async () => {
    vi.mocked(queues.deadLetter.add).mockRejectedValueOnce(new Error('queue unavailable'));
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: {
          event_type: 'message.received',
          payload: { id: 'message-queue', from: 'sender', text: 'NON' },
        },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(mockHandleReply).not.toHaveBeenCalled();
  });

  it('renvoie 503 lorsque l’identifiant du message manque', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      payload: {
        data: { event_type: 'message.received', payload: { from: 'sender', text: 'NON' } },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(queues.deadLetter.add).not.toHaveBeenCalled();
    expect(mockHandleReply).not.toHaveBeenCalled();
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
          payload: { id: 'message-missing-from', text: 'OUI' },
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
          payload: { id: 'message-missing-text', from: '+336****5678' },
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
          payload: { id: 'message-2', from: { phone_number: '+336****9999' }, text: 'NON' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleReply).not.toHaveBeenCalled();
    expect(queues.deadLetter.add).toHaveBeenCalledOnce();
  });
});
