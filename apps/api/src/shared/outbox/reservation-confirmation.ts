import type { Prisma } from '@prisma/client';
import { enqueue } from './outbox.service';

export async function enqueueReservationConfirmation(
  tx: Prisma.TransactionClient,
  reservation: {
    id: string;
    restaurantId: string;
    state: string;
    customerPhone: string | null;
    channel: string;
  },
): Promise<boolean> {
  // Voice keeps its existing confirmation path; do not open messaging on MCP/other integrations.
  if (
    reservation.channel !== 'WEB' ||
    reservation.state !== 'CONFIRMED' ||
    !reservation.customerPhone
  )
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
