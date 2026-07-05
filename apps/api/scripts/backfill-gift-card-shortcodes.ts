/**
 * Backfill — Génère un shortCode unique (SKR-XXXX-XX) pour toutes les
 * cartes cadeau qui n'en ont pas encore (shortCode IS NULL).
 *
 * Usage :
 *   npx tsx apps/api/scripts/backfill-gift-card-shortcodes.ts
 *
 * Le script est idempotent : si une carte a déjà un shortCode, il l'ignore.
 * En cas de collision, le retry est géré par generateUniqueShortCode (max 10 tentatives).
 *
 * Exécuter en local d'abord, puis en production après déploiement.
 */
import { PrismaClient } from '@prisma/client';
import { generateUniqueShortCode } from '../src/modules/gift-cards/gift-card-code.util.js';

const prisma = new PrismaClient();

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function logError(msg: string): void {
  process.stderr.write(msg + '\n');
}

async function main(): Promise<void> {
  log('🔍 Récupération des cartes cadeau sans shortCode...');

  const cards = await prisma.giftCard.findMany({
    where: { shortCode: null },
    select: { id: true, code: true },
  });

  if (cards.length === 0) {
    log('✅ Toutes les cartes cadeau ont déjà un shortCode. Rien à faire.');
    return;
  }

  log(`📋 ${cards.length} carte(s) à traiter.`);

  let success = 0;
  let errors = 0;

  for (const card of cards) {
    try {
      const shortCode = await generateUniqueShortCode(prisma);
      await prisma.giftCard.update({
        where: { id: card.id },
        data: { shortCode },
      });
      log(`  ✅ ${card.code} → ${shortCode}`);
      success++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`  ❌ ${card.code} : ${message}`);
      errors++;
    }
  }

  log(`\n📊 Terminé : ${success} succès, ${errors} erreur(s).`);
}

main()
  .catch((err) => {
    logError(`Erreur fatale : ${err}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
