import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createWhatsAppReminderConsent,
  withdrawWhatsAppReminderConsent,
  WHATSAPP_REMINDER_CONSENT_VERSION,
} from '../whatsapp-consent';
import { ConfirmInputSchema } from '../connect.types';

describe('reservation WhatsApp agreement', () => {
  it('does not infer WhatsApp permission from an absent choice', () => {
    expect(createWhatsAppReminderConsent(false)).toEqual({
      consents: { transactionalWhatsapp: false },
      withdrawalToken: undefined,
    });
  });

  it('records scoped evidence and stores only the withdrawal token hash', () => {
    const result = createWhatsAppReminderConsent(true, 'ip-hash');
    expect(result.consents).toMatchObject({
      transactionalWhatsapp: true,
      whatsappConsentProof: {
        version: WHATSAPP_REMINDER_CONSENT_VERSION,
        purpose: 'reservation_reminder',
        ipHash: 'ip-hash',
      },
    });
    expect(JSON.stringify(result.consents)).not.toContain(result.withdrawalToken);
  });

  it.each(['true', 1, null])('rejects non boolean agreement %s', (accepted) => {
    expect(
      ConfirmInputSchema.safeParse({
        holdToken: ['hold', 'token', 'example'].join('-'),
        customer: { firstName: 'Example', phone: '+15005550006' },
        whatsappReminderConsent: { accepted, version: WHATSAPP_REMINDER_CONSENT_VERSION },
      }).success,
    ).toBe(false);
  });

  it('requires the scoped token and tenant before withdrawal', async () => {
    const record = createWhatsAppReminderConsent(true);
    const db = {
      reservation: {
        findFirst: vi.fn().mockResolvedValue({ consents: record.consents }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    expect(
      await withdrawWhatsAppReminderConsent(
        db as unknown as PrismaClient,
        'restaurant',
        'reservation',
        'invalid',
      ),
    ).toBe('not_found');
    expect(db.reservation.updateMany).not.toHaveBeenCalled();
    expect(
      await withdrawWhatsAppReminderConsent(
        db as unknown as PrismaClient,
        'restaurant',
        'reservation',
        record.withdrawalToken!,
      ),
    ).toBe('withdrawn');
    expect(db.reservation.findFirst).toHaveBeenCalledWith({
      where: { id: 'reservation', restaurantId: 'restaurant' },
      select: { consents: true },
    });
    expect(db.reservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          consents: expect.objectContaining({
            transactionalWhatsapp: false,
            whatsappConsentProof: record.consents.whatsappConsentProof,
          }),
        },
      }),
    );
  });

  it('does not overwrite a concurrent consent change', async () => {
    const record = createWhatsAppReminderConsent(true);
    const db = {
      reservation: {
        findFirst: vi.fn().mockResolvedValue({ consents: record.consents }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    expect(
      await withdrawWhatsAppReminderConsent(
        db as unknown as PrismaClient,
        'restaurant',
        'reservation',
        record.withdrawalToken!,
      ),
    ).toBe('conflict');
  });
});
