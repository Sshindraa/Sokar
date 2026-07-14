// ESLint 9 flat config for @sokar/api
// Shared/base rules live in @sokar/config; this file adds API-specific type-aware rules
// and per-file overrides.
import sokarBase, { prettier } from '@sokar/config/eslint.config.mjs';

export default [
  ...sokarBase,

  // Type-aware rules for the API src/ tree
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // Test files: more relaxed (vi.fn() returns are loosely typed on purpose)
  {
    files: ['src/**/__tests__/**/*.ts', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
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

  // Prettier must be last so it disables any formatting rules from plugins
  prettier,
];
