import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Hermes sandbox cannot read .env files (Resource deadlock on
// com.apple.provenance xattr). We monkey-patch fs.readFileSync to noop
// for .env files so Vite's loadEnv doesn't crash. Real test env vars are
// set by src/test/setup.ts.
//
// Vitest 4 dropped poolOptions (now top-level), uses singleFork for serial
// run, and we follow the same path aliases as tsconfig.json (which point
// to the prebuilt dist outputs in packages/*).

const realFs = require('node:fs');
const originalReadFileSync = realFs.readFileSync;
realFs.readFileSync = function (...args: any[]) {
  const target = args[0];
  if (typeof target === 'string' && target.includes('.env')) {
    return '';
  }
  // @ts-expect-error -- passthrough
  return originalReadFileSync.apply(this, args);
} as any;

export default defineConfig({
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
      '@sokar/types': path.resolve(__dirname, '../../packages/types/dist/call-event.js'),
    },
  },
});
