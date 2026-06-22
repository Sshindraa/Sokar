/**
 * Worker d'anonymisation automatique (RGPD — rétention 2 ans).
 *
 * Tourne quotidiennement. Pour chaque résa plus vieille que 2 ans
 * ET sans interaction récente, anonymise la PII (customerName, customerPhone,
 * customerId, specialRequests).
 *
 * Note : la rétention "sans interaction" signifie que le client n'a pas
 * eu de nouvelle résa dans les 2 ans. Sinon, on conserve.
 *
 * Stratégie MVP : on anonymise toute résa de plus de 2 ans dont le client
 * n'a pas eu d'autre résa dans les 6 derniers mois. C'est volontairement
 * conservateur — à ajuster après le pilote.
 */

import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import { logger } from '../../shared/logger/pino';

export const ANONYMIZATION_RETENTION_DAYS = 730; // 2 ans
export const ANONYMIZATION_GRACE_DAYS = 180; // 6 mois

export type AnonymizationResult = {
  scanned: number;
  anonymized: number;
  errors: number;
  durationMs: number;
};

export async function runAnonymization(prisma: PrismaClient): Promise<AnonymizationResult> {
  const start = Date.now();
  const cutoffAnonymize = new Date(Date.now() - ANONYMIZATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffGrace = new Date(Date.now() - ANONYMIZATION_GRACE_DAYS * 24 * 60 * 60 * 1000);

  logger.info({ cutoffAnonymize, cutoffGrace }, 'Starting RGPD anonymization scan');

  // 1. Trouver les candidats : résas de +2 ans, non anonymisées
  const candidates = await prisma.reservation.findMany({
    where: {
      createdAt: { lt: cutoffAnonymize },
      customerName: { not: 'ANON' }, // Pas déjà anonymisé
    },
    select: {
      id: true,
      customerPhone: true,
      restaurantId: true,
    },
  });

  let anonymized = 0;
  let errors = 0;

  // 2. Pour chaque candidat, vérifier s'il y a eu d'autres résas récentes
  for (const c of candidates) {
    if (!c.customerPhone) {
      // Pas de phone, on anonymise (PII déjà effacée mais customerName peut rester)
      await anonymizeOne(prisma, c.id);
      anonymized++;
      continue;
    }
    try {
      const recentCount = await prisma.reservation.count({
        where: {
          customerPhone: c.customerPhone,
          createdAt: { gt: cutoffGrace },
        },
      });
      if (recentCount === 0) {
        await anonymizeOne(prisma, c.id);
        anonymized++;
      }
    } catch (err) {
      logger.error({ err, reservationId: c.id }, 'Anonymization failed for one reservation');
      errors++;
    }
  }

  const durationMs = Date.now() - start;
  logger.info(
    { scanned: candidates.length, anonymized, errors, durationMs },
    'RGPD anonymization scan complete',
  );

  return {
    scanned: candidates.length,
    anonymized,
    errors,
    durationMs,
  };
}

async function anonymizeOne(prisma: PrismaClient, reservationId: string): Promise<void> {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      customerName: 'ANON',
      customerPhone: null,
      customerId: null,
      specialRequests: null,
    },
  });
}

/**
 * Schedule le cron d'anonymisation (1x par jour à 3h du matin).
 * Idempotent — peut être appelé plusieurs fois.
 */
export async function scheduleAnonymizationCron(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    'rgpd-anonymization',
    { pattern: '0 3 * * *', tz: 'Europe/Paris' },
    {
      name: 'rgpd-anonymization-daily',
      data: { type: 'rgpd_anonymization' },
    },
  );
}
