import type { PrismaClient } from '@prisma/client';
import { CONFIRMATION_SMS_SENT_EVENT } from '../observability/system-checks';

export type NotificationRepairStatus = 'repaired' | 'not_required' | 'manual';

export type NotificationRepairReference =
  | { operation: 'outbound_confirmation'; reservationId: string }
  | { operation: 'reservation_reminder'; reservationId: string }
  | { operation: 'waiting_list_promotion'; entryId: string }
  | { operation: 'call_recovery'; callId: string }
  | { operation: 'gift_card_reminder'; giftCardId: string };

/**
 * Maps only the stable, internal claim namespace to a repair operation. Claim
 * keys never contain recipient data; unsupported keys are sent to review.
 */
export function parseNotificationRepairReference(
  claimKey: string,
): NotificationRepairReference | null {
  const prefix = 'notification:';
  if (!claimKey.startsWith(prefix)) return null;

  const remainder = claimKey.slice(prefix.length);
  const separator = remainder.indexOf(':');
  if (separator <= 0 || separator === remainder.length - 1) return null;

  const operation = remainder.slice(0, separator);
  const id = remainder.slice(separator + 1);
  switch (operation) {
    case 'reservation-confirmation-sms':
      return { operation: 'outbound_confirmation', reservationId: id };
    case 'reservation-reminder-sms':
    case 'reservation-reminder-whatsapp':
      return { operation: 'reservation_reminder', reservationId: id };
    case 'waiting-list-promotion-sms':
    case 'waiting-list-promotion-email':
      return { operation: 'waiting_list_promotion', entryId: id };
    case 'call-recovery-sms':
      return { operation: 'call_recovery', callId: id };
    case 'gift-card-expiration-reminder':
      return { operation: 'gift_card_reminder', giftCardId: id };
    default:
      return null;
  }
}

async function repairOutboundConfirmation(
  db: PrismaClient,
  reservationId: string,
): Promise<NotificationRepairStatus> {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true },
  });
  if (!reservation) return 'manual';

  const existing = await db.reservationAuditLog.findFirst({
    where: { reservationId, event: CONFIRMATION_SMS_SENT_EVENT },
    select: { id: true },
  });
  if (existing) return 'not_required';

  await db.reservationAuditLog.create({
    data: {
      reservationId,
      actor: 'system',
      event: CONFIRMATION_SMS_SENT_EVENT,
      metadata: { channel: 'sms', repairedFromProvider: true },
    },
  });
  return 'repaired';
}

async function repairReservationReminder(
  db: PrismaClient,
  reservationId: string,
  now: Date,
): Promise<NotificationRepairStatus> {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true, state: true, confirmationSentAt: true },
  });
  if (!reservation) return 'manual';
  if (reservation.confirmationSentAt) return 'not_required';
  if (reservation.status !== 'CONFIRMED' || reservation.state !== 'CONFIRMED') {
    return 'manual';
  }

  const updated = await db.reservation.updateMany({
    where: {
      id: reservationId,
      status: 'CONFIRMED',
      state: 'CONFIRMED',
      confirmationSentAt: null,
    },
    data: {
      confirmationStatus: 'PENDING',
      confirmationSentAt: now,
    },
  });
  if (updated.count > 0) return 'repaired';

  const latest = await db.reservation.findUnique({
    where: { id: reservationId },
    select: { confirmationSentAt: true },
  });
  return latest?.confirmationSentAt ? 'not_required' : 'manual';
}

async function repairGiftCardReminder(
  db: PrismaClient,
  giftCardId: string,
  now: Date,
): Promise<NotificationRepairStatus> {
  const giftCard = await db.giftCard.findUnique({
    where: { id: giftCardId },
    select: { reminderSentAt: true },
  });
  if (!giftCard) return 'manual';
  if (giftCard.reminderSentAt) return 'not_required';

  const updated = await db.giftCard.updateMany({
    where: { id: giftCardId, reminderSentAt: null },
    data: { reminderSentAt: now },
  });
  if (updated.count > 0) return 'repaired';

  const latest = await db.giftCard.findUnique({
    where: { id: giftCardId },
    select: { reminderSentAt: true },
  });
  return latest?.reminderSentAt ? 'not_required' : 'manual';
}

/**
 * Repairs only markers/audits that already exist in the current contract.
 * Waiting-list promotion and call recovery have no durable notification
 * marker today, so a verified provider result is sufficient for this phase.
 */
export async function repairNotificationAfterProviderSuccess(
  db: PrismaClient,
  claimKey: string,
  now = new Date(),
): Promise<NotificationRepairStatus> {
  const reference = parseNotificationRepairReference(claimKey);
  if (!reference) return 'manual';

  switch (reference.operation) {
    case 'outbound_confirmation':
      return repairOutboundConfirmation(db, reference.reservationId);
    case 'reservation_reminder':
      return repairReservationReminder(db, reference.reservationId, now);
    case 'gift_card_reminder':
      return repairGiftCardReminder(db, reference.giftCardId, now);
    case 'waiting_list_promotion':
    case 'call_recovery':
      return 'not_required';
  }
}
