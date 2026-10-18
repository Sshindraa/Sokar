import nextVitals from 'eslint-config-next/core-web-vitals';
import { prettier } from '../../packages/config/eslint.config.mjs';

export default [
  ...nextVitals,
  prettier,
  // Newly enabled React Compiler diagnostics stay visible during the Next upgrade.
  // Promote these to errors after the existing components have been migrated.
  // rules-of-hooks remains an error; exhaustive-deps keeps Next's warning level.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  { ignores: ['.next/**', 'out/**', 'dist/**', 'coverage/**', '.turbo/**'] },
];
