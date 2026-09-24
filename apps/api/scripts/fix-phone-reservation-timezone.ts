/**
 * Recale les réservations téléphoniques enregistrées dans le fuseau du serveur
 * au lieu de celui du restaurant (bug corrigé par 4e28e85).
 *
 * À lancer UNIQUEMENT si le serveur n'était pas dans le fuseau des restaurants
 * (vérifier `timedatectl` sur le VPS). Aperçu par défaut ; --apply écrit après
 * avoir sauvegardé les valeurs d'origine dans le fichier --backup.
 *
 *   pnpm --filter @sokar/api ops:phone-reservation-timezone -- \
 *     --server-timezone UTC --before 2026-09-24T12:00:00Z
 *   pnpm --filter @sokar/api ops:phone-reservation-timezone -- \
 *     --server-timezone UTC --before <date du déploiement du correctif> \
 *     --backup ./phone-reservation-timezone-backup.json --apply
 *
 * Options :
 *   --server-timezone <tz>  Fuseau du serveur au moment des réservations (obligatoire).
 *   --before <ISO>          Réservations créées avant le déploiement du correctif (obligatoire).
 *   --restaurant-id <id>    Limite à un restaurant.
 *   --backup <fichier>      Fichier de sauvegarde, qui ne doit pas exister (obligatoire avec --apply).
 *   --apply                 Écrit en base. Sans lui, rien n'est modifié.
 *
 * Ne relancer jamais --apply sur les mêmes réservations : la correction se
 * cumulerait. Le fichier de sauvegarde permet de revenir en arrière.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { db } from '../src/shared/db/client';
import { DEFAULT_RESTAURANT_TIMEZONE } from '../src/shared/timezone/restaurant-time';
import { correctPhoneReservationInstant } from '../src/modules/voice/phone-reservation-timezone-fix';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

interface Args {
  serverTimeZone: string;
  before: Date;
  restaurantId?: string;
  backup?: string;
  apply: boolean;
}

function readArgs(argv: string[]): Args {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (argv.includes('--help') || argv.includes('-h')) {
    log('Voir l’en-tête de scripts/fix-phone-reservation-timezone.ts');
    process.exit(0);
  }
  const serverTimeZone = value('--server-timezone');
  const beforeRaw = value('--before');
  if (!serverTimeZone || !beforeRaw) {
    throw new Error('--server-timezone et --before sont obligatoires.');
  }
  // Valide le fuseau (lève RangeError s'il est inconnu).
  new Intl.DateTimeFormat('en-US', { timeZone: serverTimeZone });
  const before = new Date(beforeRaw);
  if (Number.isNaN(before.getTime())) throw new Error(`--before invalide : ${beforeRaw}`);
  const apply = argv.includes('--apply');
  const backup = value('--backup');
  if (apply && !backup) throw new Error('--backup est obligatoire avec --apply.');
  if (backup && existsSync(backup)) {
    throw new Error(`Le fichier ${backup} existe déjà : correction peut-être déjà appliquée.`);
  }
  return { serverTimeZone, before, restaurantId: value('--restaurant-id'), backup, apply };
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  // tenant-scoping: global — script d'exploitation sur toutes les réservations téléphoniques.
  const reservations = await db.reservation.findMany({
    where: {
      callId: { not: null },
      createdAt: { lt: args.before },
      ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
    },
    select: {
      id: true,
      restaurantId: true,
      reservedAt: true,
      endsAt: true,
      createdAt: true,
      restaurant: { select: { timezone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const changes = reservations
    .map((reservation) => {
      const timezone = reservation.restaurant.timezone || DEFAULT_RESTAURANT_TIMEZONE;
      const fix = correctPhoneReservationInstant(
        reservation.reservedAt,
        args.serverTimeZone,
        timezone,
      );
      return { reservation, timezone, fix };
    })
    .filter(({ fix }) => fix.shiftMs !== 0);

  log(
    `${reservations.length} réservation(s) téléphonique(s) créée(s) avant ${args.before.toISOString()} ; ${changes.length} à recaler.`,
  );
  for (const { reservation, timezone, fix } of changes) {
    log(
      `${reservation.id} [${timezone}] ${reservation.reservedAt.toISOString()} → ${fix.corrected.toISOString()} (heure voulue ${fix.localDate} ${fix.localTime}, ${fix.shiftMs / 60_000} min)`,
    );
  }

  if (!args.apply) {
    log('Aperçu uniquement. Ajouter --backup <fichier> --apply pour écrire.');
    return;
  }

  writeFileSync(
    args.backup!,
    JSON.stringify(
      {
        serverTimeZone: args.serverTimeZone,
        before: args.before.toISOString(),
        createdAt: new Date().toISOString(),
        reservations: changes.map(({ reservation }) => ({
          id: reservation.id,
          reservedAt: reservation.reservedAt.toISOString(),
          endsAt: reservation.endsAt?.toISOString() ?? null,
        })),
      },
      null,
      2,
    ),
  );
  log(`Sauvegarde écrite dans ${args.backup}.`);

  let updated = 0;
  for (const { reservation, fix } of changes) {
    await db.reservation.update({
      where: { id: reservation.id },
      data: {
        reservedAt: fix.corrected,
        ...(reservation.endsAt
          ? { endsAt: new Date(reservation.endsAt.getTime() + fix.shiftMs) }
          : {}),
      },
    });
    updated++;
  }
  log(`${updated} réservation(s) recalée(s).`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
