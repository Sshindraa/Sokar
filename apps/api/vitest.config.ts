import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    // Coverage: v8 is the fastest, accurate enough for our TS code.
    // Thresholds are checked at the end of `pnpm test:coverage` and
    // fail the run if the global coverage drops below `lines`/`functions`.
    //
    // Scope rationale: we cover HTTP route handlers and the service layer
    // (the surface with stable contracts). Excluded: dev-only routes, the
    // voice stream pipeline (covered by manual Telnyx E2E tests, not unit
    // tests), background workers (tested by mock data on staging), and
    // third-party SDK wrappers (exercised by the services that use them).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**', // helpers, setup — tested by usage, not directly
        'src/types/**', // .d.ts and ambient declarations
        'src/main.ts', // entry point — exercised by integration tests
        // Dev-only sandbox routes (only run with NODE_ENV !== 'production')
        'src/modules/test/**',
        // Voice pipeline: real-time WS handlers. Exhaustive unit tests give
        // false confidence; manual E2E with Telnyx/Deepgram is the source
        // of truth. Excluded to keep the threshold realistic.
        'src/modules/voice/stream/**',
        'src/modules/voice/telnyx.guard.ts',
        'src/modules/voice/telnyx.pipeline.ts',
        // Background workers: integration-tested via BullMQ mock on staging
        'src/shared/queue/workers/**',
        // Third-party SDK wrappers: tested through the services that use them
        'src/shared/telnyx/**',
        'src/shared/google-calendar/**',
        'src/shared/aws/**',
        'src/shared/email/**',
        'src/shared/configcat/**',
        'src/shared/sentry/**',
        'src/plugins/clerk.ts', // Clerk SDK wrapper, real auth in staging
      ],
      // Baseline measured at ~63% lines / ~67% functions / ~56% branches
      // across the included scope (after excluding the voice pipeline and
      // third-party SDK wrappers, which are tested manually). 60% lines
      // is the floor — a drop signals a route shipped untested. Bump as
      // we cover more (target: 80% lines).
      thresholds: {
        lines: 60,
        functions: 65,
        branches: 55,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@sokar/config': '../../packages/config/src/constants.ts',
      '@sokar/types': '../../packages/types/src/call-event.ts',
    },
  },
});
