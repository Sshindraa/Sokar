import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  oxc: {
    // `jsx: 'automatic'` active le parsing JSX dans le transform oxc/rolldown
    // (requis pour les fichiers .tsx de test — sans ça, ssrTransformScript échoue).
    // Le type TS n'accepte que `"preserve" | JsxOptions`, mais la valeur runtime
    // `'automatic'` est bien supportée par oxc.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jsx: 'automatic' as any,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sokar/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
