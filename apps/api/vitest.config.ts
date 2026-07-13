import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Désactive le chargement des fichiers .env par Vite (sinon certains
// environnements sandboxés bloquent sur l'xattr com.apple.provenance).
// Les variables d'env des tests sont injectées par src/test/setup.ts.
//
// Vitest 4 dropped poolOptions (now top-level), uses singleFork for serial
// run, and we follow the same path aliases as tsconfig.json (which point
// to the prebuilt dist outputs in packages/*).

export default defineConfig({
  envDir: false,
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    env: {},
    pool: 'forks',
    singleFork: true,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@sokar/config': path.resolve(__dirname, '../../packages/config/dist/constants.js'),
      '@sokar/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@sokar/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
