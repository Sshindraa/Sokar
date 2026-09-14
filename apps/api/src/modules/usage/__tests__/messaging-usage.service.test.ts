import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/outbox/outbox.service', () => ({
  enqueueOnDatabase: vi.fn().mockResolvedValue({ created: true }),
}));

import { enqueueOnDatabase } from '../../../shared/outbox/outbox.service';
import {
  buildMessagingUsageKey,
  countSmsSegments,
  countSmsUnits,
  recordAcceptedMessagingUsage,
  usageCategoryForChannel,
} from '../messaging-usage.service';

const CONTEXT = {
  restaurantId: 'restaurant-1',
  sourceType: 'reservation_reminder',
  sourceId: 'reservation-1',
};

describe('messaging usage collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enqueueOnDatabase).mockResolvedValue({ created: true } as never);
  });

  it('counts GSM-7, extended and Unicode SMS segments with provider limits', () => {
    expect(countSmsUnits('a'.repeat(160))).toEqual({ units: 160, encoding: 'gsm7' });
    expect(countSmsSegments('a'.repeat(160))).toBe(1);
    expect(countSmsSegments('a'.repeat(161))).toBe(2);
    expect(countSmsUnits('€')).toEqual({ units: 2, encoding: 'gsm7' });
    expect(countSmsSegments('€'.repeat(81))).toBe(2);
    expect(countSmsUnits('🙂')).toEqual({ units: 2, encoding: 'ucs2' });
    expect(countSmsSegments('🙂'.repeat(70))).toBe(3);
    expect(countSmsSegments('')).toBe(0);
  });

  it('maps channels to the ledger categories and stable keys', () => {
    expect(usageCategoryForChannel('sms')).toBe('SMS_SEGMENTS');
    expect(usageCategoryForChannel('whatsapp')).toBe('WHATSAPP_MESSAGES');
    expect(usageCategoryForChannel('email')).toBe('EMAIL_MESSAGES');
    expect(buildMessagingUsageKey(CONTEXT, 'sms')).toBe(
      'messaging:sms:reservation_reminder:reservation-1:accepted',
    );
  });

  it('enqueues accepted SMS usage without copying recipient PII', async () => {
    await recordAcceptedMessagingUsage({
      channel: 'sms',
      provider: ' Telnyx ',
      text: 'a'.repeat(161),
      providerMessageId: 'msg-1',
      context: { ...CONTEXT, metadata: { messageType: 'reminder' } },
    });

    expect(enqueueOnDatabase).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'restaurant-1',
        topic: 'usage',
        aggregateType: 'message',
        aggregateId: 'reservation-1',
        eventType: 'usage.messaging.accepted',
        idempotencyKey: 'messaging:sms:reservation_reminder:reservation-1:accepted',
        payload: expect.objectContaining({
          category: 'SMS_SEGMENTS',
          provider: 'telnyx',
          quantity: 2,
          unit: 'segments',
          sourceType: 'reservation_reminder',
          sourceId: 'reservation-1',
          metadata: expect.objectContaining({ providerMessageId: 'msg-1' }),
        }),
      }),
    );
    const call = vi.mocked(enqueueOnDatabase).mock.calls[0]?.[0];
    expect(JSON.stringify(call)).not.toMatch(/phone|email|recipient/i);
  });

  it('records one accepted unit for WhatsApp and email', async () => {
    await recordAcceptedMessagingUsage({
      channel: 'whatsapp',
      provider: 'telnyx',
      context: { ...CONTEXT, sourceType: 'waiting_list_promotion' },
    });
    await recordAcceptedMessagingUsage({
      channel: 'email',
      provider: 'resend',
      context: { ...CONTEXT, sourceType: 'evening_report' },
    });

    expect(vi.mocked(enqueueOnDatabase).mock.calls[0]?.[0].payload).toEqual(
      expect.objectContaining({ category: 'WHATSAPP_MESSAGES', quantity: 1, unit: 'messages' }),
    );
    expect(vi.mocked(enqueueOnDatabase).mock.calls[1]?.[0].payload).toEqual(
      expect.objectContaining({ category: 'EMAIL_MESSAGES', quantity: 1, unit: 'messages' }),
    );
  });

  it('does not turn an accepted provider request into a retry when the outbox is down', async () => {
    vi.mocked(enqueueOnDatabase).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      recordAcceptedMessagingUsage({
        channel: 'sms',
        provider: 'telnyx',
        text: 'hello',
        context: CONTEXT,
      }),
    ).resolves.toBeUndefined();
  });
});
