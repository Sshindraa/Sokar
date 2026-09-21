/**
 * Garde-fou R0-3 : chaque segment applicatif expose un état de chargement et
 * un état d'erreur.
 *
 * Next.js applique `loading.tsx` / `error.tsx` à tout le sous-arbre du segment,
 * donc une boundary par segment couvre ses sous-pages sans duplication. Ce test
 * échoue si un nouveau segment applicatif apparaît sans ses deux fichiers —
 * c'est exactement la règle « loading, empty, error, data » d'`AGENTS.md`.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest s'exécute avec le cwd du package dashboard.
const APP_DIR = path.resolve(process.cwd(), 'src/app');
const COMPONENTS_DIR = path.resolve(process.cwd(), 'src/components');

const APP_SEGMENTS = ['dashboard', 'admin', 'onboarding', 'mcp'];

describe('états de route du dashboard', () => {
  it('le cwd de test pointe bien sur le package dashboard', () => {
    expect(existsSync(APP_DIR), `introuvable : ${APP_DIR}`).toBe(true);
  });

  it.each(APP_SEGMENTS)('le segment %s expose loading.tsx et error.tsx', (segment) => {
    expect(existsSync(path.join(APP_DIR, segment, 'loading.tsx')), `${segment}/loading.tsx`).toBe(
      true,
    );
    expect(existsSync(path.join(APP_DIR, segment, 'error.tsx')), `${segment}/error.tsx`).toBe(true);
  });

  it('la boundary partagée et le skeleton générique existent', () => {
    expect(existsSync(path.join(COMPONENTS_DIR, 'RouteErrorState.tsx'))).toBe(true);
    expect(existsSync(path.join(COMPONENTS_DIR, 'RouteLoadingState.tsx'))).toBe(true);
  });
});
