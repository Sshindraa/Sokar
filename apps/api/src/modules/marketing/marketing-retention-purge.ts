import type { MarketingPermission, PrismaClient } from '@prisma/client';

/** Décisions du 27/10/2026, runbook marketing-email-pilot §4 : durées de conservation. */
const PROSPECT_FILE_YEARS = 3;
const PROOF_YEARS = 5;
const PURGE_BATCH_SIZE = 200;

export type MarketingRetentionPurgeResult = {
  prospectFiles: number;
  withdrawnPermissions: number;
  orphanEvents: number;
};

function yearsBefore(now: Date, years: number): Date {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

/**
 * Dernier contact venant du client : une réservation, un acte du client sur son consentement
 * (sans `actorUserId`) ou la collecte. Un e-mail envoyé par le restaurant n'en est pas un.
 */
async function lastCustomerContact(
  db: PrismaClient,
  permission: Pick<MarketingPermission, 'customerId' | 'channel' | 'consentedAt' | 'createdAt'>,
): Promise<Date> {
  // tenant-scoping: global — purge système ; l'identifiant client est unique dans son restaurant.
  const reservations = await db.reservation.aggregate({
    where: { customerId: permission.customerId, isTest: false },
    _max: { createdAt: true },
  });
  // tenant-scoping: global — purge système, bornée au client et au canal de la permission.
  const ownActs = await db.marketingPermissionEvent.aggregate({
    where: { customerId: permission.customerId, channel: permission.channel, actorUserId: null },
    _max: { occurredAt: true },
  });
  const dates = [
    reservations._max.createdAt,
    ownActs._max.occurredAt,
    permission.consentedAt,
    permission.createdAt,
  ];
  const times = dates.flatMap((date) => (date ? [date.getTime()] : []));
  return new Date(Math.max(...times));
}

/**
 * Applique les durées du runbook marketing. Le fichier de prospection (permissions non retirées)
 * disparaît 3 ans après le dernier contact venant du client. La preuve d'une permission retirée
 * disparaît avec elle 5 ans après le retrait. Une preuve restée sans permission (étape 1) est
 * supprimée 5 ans après son dernier événement, faute de date de retrait. Le registre
 * d'opposition a sa propre purge et n'est pas touché ici.
 */
export async function purgeMarketingRetention(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<MarketingRetentionPurgeResult> {
  const prospectCutoff = yearsBefore(now, PROSPECT_FILE_YEARS);
  const proofCutoff = yearsBefore(now, PROOF_YEARS);

  let prospectFiles = 0;
  let cursor: string | undefined;
  for (;;) {
    // tenant-scoping: global — purge système des fichiers de prospection de tous les restaurants.
    const page = await db.marketingPermission.findMany({
      where: { status: { not: 'OPTED_OUT' }, createdAt: { lt: prospectCutoff } },
      select: { id: true, customerId: true, channel: true, consentedAt: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    const expired: string[] = [];
    for (const permission of page) {
      const contact = await lastCustomerContact(db, permission);
      if (contact.getTime() < prospectCutoff.getTime()) expired.push(permission.id);
    }
    if (expired.length > 0) {
      // tenant-scoping: global — purge système, bornée aux ids de fichiers expirés ci-dessus.
      const result = await db.marketingPermission.deleteMany({ where: { id: { in: expired } } });
      prospectFiles += result.count;
    }
  }

  let withdrawnPermissions = 0;
  for (;;) {
    // tenant-scoping: global — purge système des permissions retirées depuis plus de 5 ans.
    const withdrawn = await db.marketingPermission.findMany({
      where: { status: 'OPTED_OUT', withdrawnAt: { lt: proofCutoff } },
      select: { id: true },
      take: PURGE_BATCH_SIZE,
    });
    if (withdrawn.length === 0) break;

    const ids = withdrawn.map((row) => row.id);
    const deleted = await db.$transaction(async (tx) => {
      // tenant-scoping: global — purge système, bornée aux permissions retirées sélectionnées.
      await tx.marketingPermissionEvent.deleteMany({ where: { permissionId: { in: ids } } });
      // tenant-scoping: global — purge système, bornée aux permissions retirées sélectionnées.
      const result = await tx.marketingPermission.deleteMany({
        where: { id: { in: ids }, status: 'OPTED_OUT' },
      });
      return result.count;
    });
    withdrawnPermissions += deleted;
    // Garde-fou : un lot sans suppression ferait boucler indéfiniment.
    if (deleted === 0) break;
  }

  // tenant-scoping: global — purge système des preuves orphelines de tous les restaurants.
  const orphans = await db.marketingPermissionEvent.deleteMany({
    where: { permissionId: null, occurredAt: { lt: proofCutoff } },
  });

  return { prospectFiles, withdrawnPermissions, orphanEvents: orphans.count };
}
