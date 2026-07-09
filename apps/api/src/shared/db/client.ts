import { PrismaClient } from '@prisma/client';
import { slowQueryExtension } from './middleware';

declare global {
  var __db: PrismaClient | undefined;
}

const prismaClient = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

// Prisma 6 a déprécié `prisma.$use(middleware)` au profit de `$extends`.
// On active le slow query logging via une query extension. Le client étendu
// retourne un type différent de `PrismaClient` ; on cast vers `PrismaClient`
// pour préserver la compatibilité de typage (60+ fichiers et services
// attendent `PrismaClient` en paramètre de constructeur). Le runtime conserve
// bien le middleware — chaque opération est mesurée et loggée si elle dépasse
// SLOW_QUERY_THRESHOLD_MS (voir middleware.ts).
//
// Quand l'ensemble des services auront migré vers un type partagé (ex. `Db`),
// on pourra retirer le cast et exposer le vrai type étendu.
//
// Note : on garde la présence de `$extends` (les mocks de test Vitest
// n'exposent pas cette méthode) pour ne pas casser l'import du module en
// environnement de test. En production, le vrai PrismaClient l'expose
// toujours.
const extendedClient =
  typeof prismaClient.$extends === 'function'
    ? (prismaClient.$extends(slowQueryExtension) as unknown as PrismaClient)
    : prismaClient;

export const db: PrismaClient = globalThis.__db ?? extendedClient;

if (process.env.NODE_ENV !== 'production') {
  globalThis.__db = db;
}

export type Db = typeof db;
