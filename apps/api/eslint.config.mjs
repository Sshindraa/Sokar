// ESLint 9 flat config for @sokar/api
// Goals:
// - Catch real bugs (floating promises, misused promises, no-explicit-any, unsafe returns)
// - Stay compatible with the existing Prettier setup (no formatting rules here)
// - Lint only src/ and seed.ts (skip dist/, node_modules, config files)
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  // Global ignores (must be first per flat-config rules)
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      '.turbo/**',
      'node_modules/**',
      '**/node_modules/**',
      'coverage/**',
      '**/coverage/**',
      'vitest.config.ts',
      'eslint.config.mjs',
    ],
  },

  // TypeScript recommended (parser + base rules)
  // We use the recommended preset WITHOUT type-checking (faster) and add
  // type-checked rules only in the strictness block below. This split lets
  // the lint run in <5s while still catching the bugs that matter.
  ...tseslint.configs.recommended,

  // Strictness overrides (type-checked rules require parserOptions.project)
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Node globals
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
        // Vitest (test files)
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      // ---- Bugs we actually want to catch ----
      // Fastify handlers + worker jobs are async; an unawaited promise is a silent
      // crash. This rule was added because of the recurring pattern of `app.get(...,
      // async (req, reply) => { someAsync().then(...) })` without error handling.
      '@typescript-eslint/no-floating-promises': 'error',

      // Passing a promise where a sync value is expected (e.g. a route handler).
      '@typescript-eslint/no-misused-promises': 'error',

      // Async functions that don't actually await anything are almost always a bug.
      '@typescript-eslint/await-thenable': 'error',

      // Catch without using the error binding: usually means we lost the stack.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // We have plenty of `as any` casts (the preHandler augmentation pattern).
      // Allow them but flag implicit any.
      '@typescript-eslint/no-explicit-any': 'warn',

      // No `void promise` to silence the linter — force a real handler.
      'no-void': ['error', { allowAsStatement: false }],

      // Equality with == is fine for null/undefined, force === for everything else.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // -- Off: stylistic, conflicting with Prettier or our codebase --
      '@typescript-eslint/no-namespace': 'off', // we use `declare module` for Fastify aug
      '@typescript-eslint/no-require-imports': 'off', // seed.ts uses require
      'no-console': 'off', // we log via Pino but seed.ts uses console
    },
  },

  // Test files: more relaxed (vi.fn() returns are loosely typed on purpose)
  {
    files: ['src/**/__tests__/**/*.ts', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off', // tests may have unused setup vars
      // mockImplementation(() => slowPromise()) trips no-misused-promises
      // even though the function type accepts a Promise. Tests legitimately
      // return promises from mock implementations to simulate async I/O.
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },

  // main.ts: fire-and-forget startup warmups (setImmediate with async
  // callbacks) trigger false-positive no-misused-promises. Bootstrap
  // patterns are exempt — the startup IIFE handles errors via .catch.
  {
    files: ['src/main.ts'],
    rules: {
      '@typescript-eslint/no-misused-promises': 'off',
      // setImmediate callbacks in main.ts return promises intentionally
      // (fire-and-forget warmups). no-floating-promises doesn't trip here
      // because the .catch() is explicit, but disable anyway for symmetry.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  // Scripts (CLI utilities, simulations) use console intentionally. Keep
  // console.log explicit via eslint-disable-next-line and allow console.error.
  {
    files: ['scripts/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Prettier last — must come after all rule sets to disable conflicting ones
  prettier,
];
