/**
 * Options de transaction Prisma par défaut.
 *
 * Prisma n'impose aucun timeout par défaut sur `$transaction` : une transaction
 * interactive peut bloquer indéfiniment si une connexion n'est pas disponible
 * ou si une requête interne hang. On définit ici deux profils réutilisables.
 *
 * - `maxWait` : temps max pour obtenir une connexion du pool.
 * - `timeout` : temps max d'exécution de la transaction une fois démarrée.
 * - `isolationLevel` : ReadCommitted (défaut PostgreSQL, cohence avec le
 *   reste de l'app — pas de lectures sales).
 *
 * Référence : https://www.prisma.io/docs/orm/prisma-client/transactions
 */
import { Prisma } from '@prisma/client';

/**
 * Transaction standard — créations de réservation, consommation de hold,
 * rachat de gift card, contribution crowdfunding.
 *
 * 5s pour obtenir une connexion, 20s d'exécution max.
 */
export const DEFAULT_TRANSACTION_OPTIONS = {
  maxWait: 5000,
  timeout: 20000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

/**
 * Transaction longue — anonymisation RGPD, opérations de masse.
 *
 * 10s pour obtenir une connexion, 30s d'exécution max.
 */
export const LONG_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 30000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;
