/**
 * Tests for the voice gift-card tools: purchaseGiftCard and recommendGiftCardAmount.
 *
 * Scopes:
 *  - purchaseGiftCard validates the minimum amount configured on the restaurant.
 *  - purchaseGiftCard refuses invalid sender phone numbers.
 *  - purchaseGiftCard creates the gift card and sends the code via SMS.
 *  - purchaseGiftCard never returns the code in the voice response.
 *  - recommendGiftCardAmount returns a suggestion text.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager } from '../stream/manager';
import { db } from '../../../shared/db/client';
import { sendSms } from '../../../shared/telnyx/client';

function makeTelnyxWs(): WebSocket {
  const ws: any = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    OPEN: WebSocket.OPEN,
  };
  return ws as WebSocket;
}

function makeSession() {
  const mgr = CallSessionManager.getInstance();
  return mgr.create({
    callControlId: 'cc-gift-1',
    callSessionId: 'cs-gift-1',
    from: '+33600000001',
    to: '+33100000000',
    restaurantId: 'rest-gift-1',
    systemPrompt: "Tu es l'assistant vocal de Test Resto.",
    isVip: false,
    telnyxWs: makeTelnyxWs(),
    callLegId: 'leg-gift-1',
    codec: 'PCMA',
  });
}

vi.mock('../../../shared/telnyx/client', () => ({
  sendSms: vi.fn(),
  default: {
    messages: { create: vi.fn() },
  },
  placeOutboundCall: vi.fn(),
}));

describe('CallSessionManager — gift card tools', () => {
  beforeEach(() => {
    (CallSessionManager as any).instance = new CallSessionManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('purchaseGiftCard', () => {
    it('rejects amounts below the restaurant minimum', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        giftCardMinimumAmount: 20,
      } as any);

      const result = await (mgr as any).executeTool(
        session,
        'purchaseGiftCard',
        JSON.stringify({
          amount: 15,
          senderName: 'Jean Dupont',
          senderPhone: '+33612345678',
          recipientName: 'Marie Dupont',
        }),
      );

      expect(result).toContain('20€');
      expect(db.restaurant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rest-gift-1' },
          select: { giftCardMinimumAmount: true },
        }),
      );
    });

    it('rejects an invalid sender phone number', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        giftCardMinimumAmount: 10,
      } as any);

      const result = await (mgr as any).executeTool(
        session,
        'purchaseGiftCard',
        JSON.stringify({
          amount: 50,
          senderName: 'Jean Dupont',
          senderPhone: '0612345678',
          recipientName: 'Marie Dupont',
        }),
      );

      expect(result).toContain('numéro de téléphone valide');
    });

    it('creates the gift card and sends the code by SMS', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        giftCardMinimumAmount: 10,
      } as any);
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gift-card-1',
        code: 'SOKAR-1234-5678-9012',
        amount: { toNumber: () => 150 },
      } as any);

      const result = await (mgr as any).executeTool(
        session,
        'purchaseGiftCard',
        JSON.stringify({
          amount: 150,
          occasion: 'Anniversaire',
          senderName: 'Jean Dupont',
          senderPhone: '+33612345678',
          recipientName: 'Marie Dupont',
          message: 'Joyeux anniversaire !',
        }),
      );

      expect(db.giftCard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            restaurantId: 'rest-gift-1',
            amount: expect.anything(),
            senderName: 'Jean Dupont',
            senderPhone: '+33612345678',
            recipientName: 'Marie Dupont',
            occasion: 'Anniversaire',
            message: 'Joyeux anniversaire !',
            createdBy: 'VOICE',
            purchaseReference: 'test',
          }),
        }),
      );
      expect(sendSms).toHaveBeenCalledWith(
        '+33612345678',
        expect.stringContaining('SOKAR-1234-5678-9012'),
      );
      expect(result).toContain('Carte cadeau');
      expect(result).toContain('SMS');
      expect(result).not.toContain('SOKAR-1234-5678-9012');
    });

    it('returns a handoff message when SMS fails', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        giftCardMinimumAmount: 10,
      } as any);
      vi.mocked(db.giftCard.create).mockResolvedValue({
        id: 'gift-card-2',
        code: 'SOKAR-9876-5432-1098',
        amount: { toNumber: () => 100 },
      } as any);
      vi.mocked(sendSms).mockRejectedValue(new Error('SMS failed'));

      const result = await (mgr as any).executeTool(
        session,
        'purchaseGiftCard',
        JSON.stringify({
          amount: 100,
          senderName: 'Jean Dupont',
          senderPhone: '+33612345678',
          recipientName: 'Marie Dupont',
        }),
      );

      expect(result).toContain('transfère');
      expect(result).not.toContain('SOKAR-9876-5432-1098');
    });
  });

  describe('recommendGiftCardAmount', () => {
    it('returns a suggestion with amount and message', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      const result = await (mgr as any).executeTool(
        session,
        'recommendGiftCardAmount',
        JSON.stringify({
          occasion: 'Anniversaire',
          partySize: 4,
        }),
      );

      expect(result).toMatch(/\d+€/);
      expect(result).toContain('Anniversaire');
      expect(result).toContain('4');
    });
  });
});
