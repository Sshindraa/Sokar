import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { CONFIRMATION_SMS_SENT_EVENT } from '../../observability/system-checks';
import {
  parseNotificationRepairReference,
  repairNotificationAfterProviderSuccess,
} from '../notification-repair';

function makeDb(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    reservation: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    reservationAuditLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    giftCard: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

describe('notification-repair', () => {
  it('ne dérive une réparation que de clés métier internes stables', () => {
    expect(
      parseNotificationRepairReference('notification:reservation-confirmation-sms:res-1'),
    ).toEqual({ operation: 'outbound_confirmation', reservationId: 'res-1' });
    expect(
      parseNotificationRepairReference('notification:gift-card-expiration-reminder:card-1'),
    ).toEqual({ operation: 'gift_card_reminder', giftCardId: 'card-1' });
    expect(parseNotificationRepairReference('notification:unsupported:opaque')).toBeNull();
  });

  it('crée l’audit outbound une seule fois lors de deux réparations séquentielles', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'audit-1' });
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const db = makeDb({
      reservation: { findUnique: vi.fn().mockResolvedValue({ id: 'res-1' }) },
      reservationAuditLog: { findFirst, create },
    });
    const key = 'notification:reservation-confirmation-sms:res-1';

    await expect(repairNotificationAfterProviderSuccess(db, key)).resolves.toBe('repaired');
    await expect(repairNotificationAfterProviderSuccess(db, key)).resolves.toBe('not_required');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        reservationId: 'res-1',
        actor: 'system',
        event: CONFIRMATION_SMS_SENT_EVENT,
        metadata: { channel: 'sms', repairedFromProvider: true },
      },
    });
  });

  it('pose le marqueur de rappel seulement pour une réservation toujours confirmée', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = makeDb({
      reservation: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'CONFIRMED',
          state: 'CONFIRMED',
          confirmationSentAt: null,
        }),
        updateMany,
      },
    });
    const now = new Date('2026-09-02T12:00:00.000Z');

    await expect(
      repairNotificationAfterProviderSuccess(
        db,
        'notification:reservation-reminder-sms:res-1',
        now,
      ),
    ).resolves.toBe('repaired');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'res-1',
        status: 'CONFIRMED',
        state: 'CONFIRMED',
        confirmationSentAt: null,
      },
      data: { confirmationStatus: 'PENDING', confirmationSentAt: now },
    });
  });

  it('refuse la réparation du rappel si status/state ne prouvent plus la confirmation', async () => {
    const updateMany = vi.fn();
    const db = makeDb({
      reservation: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'CONFIRMED',
          state: 'PENDING',
          confirmationSentAt: null,
        }),
        updateMany,
      },
    });

    await expect(
      repairNotificationAfterProviderSuccess(db, 'notification:reservation-reminder-sms:res-1'),
    ).resolves.toBe('manual');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('utilise un update conditionnel idempotent pour le rappel gift card', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = makeDb({
      giftCard: {
        findUnique: vi.fn().mockResolvedValue({ reminderSentAt: null }),
        updateMany,
      },
    });
    const now = new Date('2026-09-02T12:00:00.000Z');

    await expect(
      repairNotificationAfterProviderSuccess(
        db,
        'notification:gift-card-expiration-reminder:card-1',
        now,
      ),
    ).resolves.toBe('repaired');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'card-1', reminderSentAt: null },
      data: { reminderSentAt: now },
    });
  });

  it('ne fabrique pas de nouvel audit pour waiting list/call recovery', async () => {
    const db = makeDb();

    await expect(
      repairNotificationAfterProviderSuccess(db, 'notification:waiting-list-promotion-sms:entry-1'),
    ).resolves.toBe('not_required');
    await expect(
      repairNotificationAfterProviderSuccess(db, 'notification:call-recovery-sms:call-1'),
    ).resolves.toBe('not_required');

    expect(db.reservationAuditLog.create).not.toHaveBeenCalled();
  });
});
