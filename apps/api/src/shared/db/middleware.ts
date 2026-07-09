/**
 * Prisma slow query logging middleware.
 *
 * Prisma 6 a déprécié `prisma.$use(middleware)` au profit de `$extends`.
 * On définit ici une query extension qui mesure la durée de chaque opération
 * et logge un avertissement quand elle dépasse le seuil configuré.
 *
 * Activation : voir `client.ts` — le client étendu est casté vers
 * `PrismaClient` pour préserver la compatibilité de typage (les services
 * attendent `PrismaClient` en constructeur). Le runtime conserve bien le
 * middleware.
 */
import { logger } from '../logger/pino';

/** Seuil au-delà duquel une requête Prisma est considérée comme lente (ms). */
export const SLOW_QUERY_THRESHOLD_MS = 5000;

/**
 * Query extension Prisma 6 qui journalise les requêtes lentes.
 *
 * `$allOperations` intercepte chaque méthode (findUnique, create, updateMany,
 * $transaction interne, etc.) et mesure la durée d'exécution.
 */
export const slowQueryExtension = {
  query: {
    $allOperations: async ({
      model,
      operation,
      args,
      query,
    }: {
      model?: string;
      operation: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (args: unknown) => Promise<unknown>;
    }) => {
      const start = Date.now();
      const result = await query(args);
      const duration = Date.now() - start;

      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        logger.warn(
          {
            model,
            operation,
            duration,
            threshold: SLOW_QUERY_THRESHOLD_MS,
          },
          'Slow Prisma query detected',
        );
      }

      return result;
    },
  },
};
