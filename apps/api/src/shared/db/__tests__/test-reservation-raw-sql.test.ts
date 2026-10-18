import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Garde-fou : l'extension Prisma (`test-reservation-scope.ts`) n'agit ni sur le SQL brut ni sur
// les lectures de réservations passant par une relation. Chaque fichier concerné doit donc
// soit exclure `is_test` / `isTest`, soit être listé ci-dessous avec la raison.
// Détection volontairement simple, au niveau du fichier : une exclusion explicite
// (`is_test = false` en SQL ou `isTest: false` en Prisma) n'importe où dans le fichier suffit.
// Une simple mention (`isTestCallRecordingEnabled`, `const isTest = …`) ne compte pas.

/**
 * Fichier (relatif à apps/api/src) → raison pour laquelle il n'a pas besoin du filtre.
 * Les exceptions valent pour tout le fichier : une nouvelle requête ajoutée dans un fichier listé
 * n'est plus contrôlée. Vérifiez la raison à chaque ajout de SQL brut dans ces fichiers.
 */
export const RAW_SQL_RESERVATION_EXCEPTIONS: Record<string, string> = {
  'modules/reservations/reservation-lifecycle.service.ts':
    'Verrou FOR UPDATE sur une seule réservation ciblée par id.',
  'modules/reservations/reservation-management.routes.ts':
    'Verrou FOR UPDATE sur une seule réservation ciblée par id.',
  'modules/agentic-reservations/core/reservation.service.ts':
    'Verrou FOR UPDATE sur une seule réservation ciblée par id.',
  'modules/gift-cards/gift-card.service.ts':
    'Verrou FOR UPDATE sur une seule réservation ciblée par id.',
  'modules/gift-cards/gift-card-operations.service.ts':
    'Verrou FOR UPDATE sur une seule réservation ciblée par id.',
  'modules/floor-plan/service-copilot-delay-recovery.service.ts':
    'Verrous FOR UPDATE sur des réservations ciblées par id.',
  'modules/experiences/experience.service.ts':
    'Les relations `reservations` sont des ExperienceReservation, pas des Reservation.',
  'modules/experiences/experience-payment.service.ts':
    'Les relations `reservations` sont des ExperienceReservation, pas des Reservation.',
};

const SRC_ROOT = path.resolve(__dirname, '../../..');
const RAW_CALL = /\$queryRaw(?:Unsafe)?|\$executeRaw(?:Unsafe)?|Prisma\.sql/g;
const RESERVATIONS_TABLE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+"?reservations"?\b/i;
const RELATION_READ =
  /reservations:\s*(?:\{|true)|_count:\s*\{\s*select:\s*\{[^}]*\breservations\b/;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' ? [] : listSourceFiles(full);
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('.d.ts')) return [];
    return [full];
  });
}

/** Texte du premier gabarit (entre deux backticks) qui suit chaque appel SQL brut. */
function rawSqlTemplates(source: string): string[] {
  const templates: string[] = [];
  for (const match of source.matchAll(RAW_CALL)) {
    const start = source.indexOf('`', match.index);
    if (start === -1) continue;
    const end = source.indexOf('`', start + 1);
    if (end === -1) continue;
    templates.push(source.slice(start + 1, end));
  }
  return templates;
}

const files = listSourceFiles(SRC_ROOT).map((full) => ({
  rel: path.relative(SRC_ROOT, full).split(path.sep).join('/'),
  source: readFileSync(full, 'utf8'),
}));

const isCovered = (rel: string, source: string) =>
  /\bis_test\s*=\s*false\b|\bisTest:\s*false\b/.test(source) ||
  rel in RAW_SQL_RESERVATION_EXCEPTIONS;

describe('réservations test : SQL brut et relations', () => {
  it('chaque SQL brut sur reservations exclut is_test ou est une exception documentée', () => {
    const offenders = files
      .filter(({ source }) => rawSqlTemplates(source).some((t) => RESERVATIONS_TABLE.test(t)))
      .filter(({ rel, source }) => !isCovered(rel, source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('chaque lecture de reservations par relation exclut isTest ou est une exception documentée', () => {
    const offenders = files
      .filter(({ source }) => RELATION_READ.test(source))
      .filter(({ rel, source }) => !isCovered(rel, source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('ne compte comme filtre qu’une vraie exclusion is_test = false / isTest: false', () => {
    const rel = 'modules/fake/fake.service.ts';
    expect(isCovered(rel, 'if (settings.isTestCallRecordingEnabled) {}')).toBe(false);
    expect(isCovered(rel, 'const isTest = input.isTest === true;')).toBe(false);
    expect(isCovered(rel, 'WHERE r.is_test = false')).toBe(true);
    expect(isCovered(rel, 'WHERE r.is_test=false')).toBe(true);
    expect(isCovered(rel, 'where: { isTest: false }')).toBe(true);
  });

  it('les exceptions pointent vers des fichiers existants', () => {
    const known = new Set(files.map((f) => f.rel));
    expect(Object.keys(RAW_SQL_RESERVATION_EXCEPTIONS).filter((f) => !known.has(f))).toEqual([]);
  });
});
