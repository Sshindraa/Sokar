// Shared ESLint flat config for Sokar workspace packages
// - TypeScript recommended (parser + base rules)
// - Common bug-catching rules (no-void, eqeqeq, unused-vars)
// - Prettier config object exported as a named export for consumers to append last
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettierPlugin from 'eslint-config-prettier';

export const prettier = prettierPlugin;

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
      'eslint.config.mjs',
      '.eslintrc.json',
      'vitest.config.ts',
    ],
  },

  // TypeScript recommended (parser + base rules)
  ...tseslint.configs.recommended,

  // Shared base rules
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      'no-console': 'off',
      'no-void': ['error', { allowAsStatement: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
