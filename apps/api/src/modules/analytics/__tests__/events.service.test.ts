/**
 * Tests for the analytics events service.
 *
 * Chaque track*() pousse un job sur la queue BullMQ `analytics`. Les
 * fonctions ne lèvent jamais d'erreur : si la queue est down, on log et
 * on continue (l'audit log ReservationAuditLog reste la preuve légale).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queues } from '../../../shared/queue/queues';
import {
  trackOnboardingEvent,
  trackRgpdEvent,
  trackMessagingEvent,
  trackGiftCardEvent,
} from '../events.service';

const analyticsAdd = vi.mocked(queues.analytics.add);

describe('analytics/events.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analyticsAdd.mockResolvedValue({} as never);
  });

  describe('trackOnboardingEvent', () => {
    it('enqueue un job avec event + restaurantId + createdAt', async () => {
      await trackOnboardingEvent({
        event: 'onboarding_step_completed',
        restaurantId: 'rest-1',
        task: 'phone_setup',
      });
      expect(analyticsAdd).toHaveBeenCalledTimes(1);
      const [name, payload] = analyticsAdd.mock.calls[0]!;
      expect(name).toBe('track');
      expect(payload).toMatchObject({
        event: 'onboarding_step_completed',
        restaurantId: 'rest-1',
        task: 'phone_setup',
      });
      expect((payload as { createdAt: string }).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("ne lève pas d'erreur si la queue échoue (best-effort)", async () => {
      analyticsAdd.mockRejectedValueOnce(new Error('Redis down'));
      await expect(
        trackOnboardingEvent({ event: 'onboarding_activated', restaurantId: 'rest-1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('trackRgpdEvent', () => {
    it("enqueue un job avec le subjectHashPrefix et l'actor", async () => {
      await trackRgpdEvent({
        event: 'rgpd_erasure',
        intent: 'erase',
        subjectHashPrefix: 'abcd1234',
        actor: 'user:self-service',
        metadata: { reservationsAnonymized: 3 },
      });
      const [name, payload] = analyticsAdd.mock.calls[0]!;
      expect(name).toBe('track');
      expect(payload).toMatchObject({
        event: 'rgpd_erasure',
        intent: 'erase',
        subjectHashPrefix: 'abcd1234',
        actor: 'user:self-service',
        metadata: { reservationsAnonymized: 3 },
      });
    });

    it('ne lève pas si la queue échoue (audit log = preuve légale)', async () => {
      analyticsAdd.mockRejectedValueOnce(new Error('Redis down'));
      await expect(
        trackRgpdEvent({ event: 'rgpd_export', subjectHashPrefix: 'abcd' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('trackMessagingEvent', () => {
    it("track l'envoi WhatsApp réussi", async () => {
      await trackMessagingEvent({
        event: 'reminder_sent',
        channel: 'whatsapp',
        restaurantId: 'rest-1',
        reservationId: 'res-1',
        success: true,
      });
      const [, payload] = analyticsAdd.mock.calls[0]!;
      expect(payload).toMatchObject({
        event: 'reminder_sent',
        channel: 'whatsapp',
        restaurantId: 'rest-1',
        success: true,
      });
    });

    it('track le fallback WhatsApp → SMS avec error', async () => {
      await trackMessagingEvent({
        event: 'whatsapp_fallback_to_sms',
        channel: 'sms',
        success: true,
        error: 'WhatsApp delivery failed: 503',
      });
      const [, payload] = analyticsAdd.mock.calls[0]!;
      expect(payload).toMatchObject({
        event: 'whatsapp_fallback_to_sms',
        channel: 'sms',
        error: 'WhatsApp delivery failed: 503',
      });
    });
  });

  describe('trackGiftCardEvent', () => {
    it("track l'achat d'une gift card depuis le voice", async () => {
      await trackGiftCardEvent({
        event: 'gift_card_purchase_completed',
        restaurantId: 'rest-1',
        source: 'voice',
        giftCardId: 'gc-1',
        amount: 100,
      });
      const [, payload] = analyticsAdd.mock.calls[0]!;
      expect(payload).toMatchObject({
        event: 'gift_card_purchase_completed',
        restaurantId: 'rest-1',
        source: 'voice',
        giftCardId: 'gc-1',
        amount: 100,
      });
    });

    it("track l'échec d'achat", async () => {
      await trackGiftCardEvent({
        event: 'gift_card_purchase_failed',
        restaurantId: 'rest-1',
        source: 'widget',
      });
      const [, payload] = analyticsAdd.mock.calls[0]!;
      expect(payload).toMatchObject({
        event: 'gift_card_purchase_failed',
        source: 'widget',
      });
    });
  });
});
