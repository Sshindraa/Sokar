// Exclut les réservations de test (`isTest`) des lectures et écritures en masse
// sur le modèle Reservation. Les requêtes ciblées par `id` ou qui mentionnent
// explicitement `isTest` (ex. purge) passent telles quelles.
const SCOPED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'groupBy',
  'aggregate',
  'updateMany',
  'deleteMany',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function scopeReservationArgs(operation: string, args: unknown): unknown {
  if (!SCOPED_OPERATIONS.has(operation)) return args;

  const base: Record<string, unknown> = isRecord(args) ? args : {};
  const where = base.where;

  if (isRecord(where) && ('id' in where || 'isTest' in where)) return args;

  if (where === undefined || where === null) {
    return { ...base, where: { isTest: false } };
  }
  return { ...base, where: { AND: [where, { isTest: false }] } };
}

export const testReservationScopeExtension = {
  query: {
    reservation: {
      $allOperations({
        operation,
        args,
        query,
      }: {
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) {
        return query(scopeReservationArgs(operation, args));
      },
    },
  },
};
