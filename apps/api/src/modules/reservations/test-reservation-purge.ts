import type { PrismaClient } from '@prisma/client';

const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH_SIZE = 200;

/**
 * Supprime les réservations test créées il y a plus de 24 h, par lots.
 * Le journal d'audit (FK Restrict) et les événements outbox (lien par
 * identifiant, sans FK) sont supprimés avant la réservation, dans la même
 * transaction. Toute requête sur Reservation porte `isTest: true`.
 */
export async function purgeTestReservations(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);
  let total = 0;

  for (;;) {
    const batch = await db.reservation.findMany({
      where: { isTest: true, createdAt: { lt: cutoff } },
      select: { id: true },
      take: PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) return total;

    const ids = batch.map((row) => row.id);
    const deleted = await db.$transaction(async (tx) => {
      await tx.reservationAuditLog.deleteMany({ where: { reservationId: { in: ids } } });
      await tx.outboxEvent.deleteMany({
        where: { aggregateType: 'reservation', aggregateId: { in: ids } },
      });
      const result = await tx.reservation.deleteMany({ where: { id: { in: ids }, isTest: true } });
      return result.count;
    });
    total += deleted;
    // Garde-fou : un lot sans suppression ferait boucler indéfiniment.
    if (deleted === 0) return total;
  }
}
