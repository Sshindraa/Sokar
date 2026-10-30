import type { Prisma } from '@prisma/client';
import { enqueue } from './outbox.service';

export async function enqueueReservationConfirmation(
  tx: Prisma.TransactionClient,
  reservation: {
    id: string;
    restaurantId: string;
    state: string;
    customerPhone: string | null;
    customerEmail?: string | null;
    channel: string;
    isTest?: boolean;
  },
): Promise<boolean> {
  const confirmationChannel = reservation.channel === 'WEB' || reservation.channel === 'ADMIN';
  if (
    confirmationChannel &&
    reservation.state === 'CONFIRMED' &&
    reservation.customerEmail &&
    !reservation.isTest
  ) {
    await enqueue(tx, {
      restaurantId: reservation.restaurantId,
      topic: 'reservation-confirmation-email',
      aggregateType: 'reservation',
      aggregateId: reservation.id,
      eventType: 'reservation.confirmation_email.requested',
      idempotencyKey: `reservation-confirmation-email:${reservation.id}`,
      payload: { reservationId: reservation.id },
    });
  }
  // Voice keeps its existing confirmation path; do not open messaging on MCP/other integrations.
  if (!confirmationChannel || reservation.state !== 'CONFIRMED' || !reservation.customerPhone)
    return false;
  const restaurant = await tx.restaurant.findUnique({
    where: { id: reservation.restaurantId },
    select: { smsConfirmEnabled: true },
  });
  if (restaurant?.smsConfirmEnabled !== true) return false;
  await enqueue(tx, {
    restaurantId: reservation.restaurantId,
    topic: 'reservation-confirmation',
    aggregateType: 'reservation',
    aggregateId: reservation.id,
    eventType: 'reservation.confirmation.requested',
    idempotencyKey: `reservation-confirmation:${reservation.id}`,
    payload: { reservationId: reservation.id },
  });
  return true;
}
