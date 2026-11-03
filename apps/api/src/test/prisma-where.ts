/**
 * Filtre minimal des clauses `where` Prisma, pour les faux clients des tests unitaires.
 * Couvre l'égalité, `not`, `in`, `lt`, `gt`, `lte`, `gte`, les listes `OR` et `AND`.
 */

const RANGE_OPERATORS = ['lt', 'lte', 'gt', 'gte'];

function sameValue(value: unknown, expected: unknown): boolean {
  if (value instanceof Date && expected instanceof Date) {
    return value.getTime() === expected.getTime();
  }
  return value === expected;
}

function compare(value: unknown, op: string, expected: unknown): boolean {
  if (value === null || value === undefined || expected === null || expected === undefined) {
    return false;
  }
  const left = value instanceof Date ? value.getTime() : (value as number);
  const right = expected instanceof Date ? expected.getTime() : (expected as number);
  switch (op) {
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    default:
      return false;
  }
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (
    condition === null ||
    typeof condition !== 'object' ||
    condition instanceof Date ||
    Array.isArray(condition)
  ) {
    return sameValue(value, condition);
  }
  const operators = condition as Record<string, unknown>;
  return Object.entries(operators).every(([op, arg]) => {
    if (RANGE_OPERATORS.includes(op)) return compare(value, op, arg);
    if (op === 'not') return sameValue(value, arg) === false;
    if (op === 'in') return Array.isArray(arg) && arg.some((item) => sameValue(value, item));
    throw new Error(`prisma-where: opérateur non géré « ${op} »`);
  });
}

/** Vrai si la ligne satisfait la clause `where`. */
export function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Record<string, unknown>[]).some((c) => matchesWhere(row, c));
    }
    if (key === 'AND') {
      return (condition as Record<string, unknown>[]).every((c) => matchesWhere(row, c));
    }
    if (condition === undefined) return true;
    return matchesCondition(record[key], condition);
  });
}
