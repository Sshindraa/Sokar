import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Banc d'évaluation vocal : appels LLM réels, lent et payant. Lancé à part
// (`pnpm eval:voice`), jamais par `pnpm test`. Les tableaux sont remplacés,
// pas fusionnés, pour ne pas embarquer les tests unitaires.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/**/*.eval.ts'],
    setupFiles: ['./src/modules/voice/eval/eval-env.ts', './src/test/setup.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
