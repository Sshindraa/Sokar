/**
 * Vérification — Toutes les cartes cadeau ont-elles un shortCode ?
 *
 * Usage :
 *   npx tsx apps/api/scripts/check-gift-card-shortcodes.ts
 *
 * Affiche : total=X with_short_code=Y missing=Z
 * Sort avec code 0 si aucun manquant, 1 sinon.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function logError(msg: string): void {
  process.stderr.write(msg + '\n');
}

async function main(): Promise<void> {
  const total = await prisma.giftCard.count();
  const withShortCode = await prisma.giftCard.count({
    where: { shortCode: { not: null } },
  });
  const missing = total - withShortCode;

  log(`total=${total} with_short_code=${withShortCode} missing=${missing}`);

  if (missing > 0) {
    throw new Error(`${missing} shortCode(s) manquant(s).`);
  }
}

main()
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Erreur : ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
