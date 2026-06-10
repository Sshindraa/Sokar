import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@sokar/config': '../../packages/config/src/constants.ts',
      '@sokar/types': '../../packages/types/src/call-event.ts',
    },
  },
});
