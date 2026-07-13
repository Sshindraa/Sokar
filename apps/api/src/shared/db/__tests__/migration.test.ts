/**
 * Test de migration (RES-011) : vérifie que l'index partiel unique
 * (idempotency_scope, idempotency_key) sur reservations est présent
 * dans la migration SQL, car Prisma ne l'affiche pas dans le schema
 * sans preview feature partialIndexes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../../../../../packages/database/prisma/migrations/20260621000000_agentic_p0_columns/migration.sql',
);

describe('RES-011 partial idempotency index migration', () => {
  it('contient un unique index partiel sur reservations(idempotency_scope, idempotency_key)', () => {
    const sql = readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "reservations_idempotency_scope_idempotency_key_key"',
    );
    expect(sql).toContain('ON "reservations"("idempotency_scope", "idempotency_key")');
    expect(sql).toContain(
      'WHERE "idempotency_scope" IS NOT NULL AND "idempotency_key" IS NOT NULL',
    );
  });
});
