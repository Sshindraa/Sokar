import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  oxc: {
    // `jsx: { runtime: 'automatic' }` active le parsing JSX dans le transform oxc/rolldown
    // (requis pour les fichiers .tsx de test — sans ça, ssrTransformScript échoue).
    jsx: { runtime: 'automatic' },
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
