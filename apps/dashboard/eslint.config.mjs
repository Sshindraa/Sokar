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
  // Garde-fou du style des écrans (docs/architecture/dashboard.md, « Style des écrans »).
  // Les exceptions datées du 2026-10-28 sont listées dans `ignores` : les retirer à la refonte de chaque écran.
  {
    files: ['src/app/dashboard/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/**',
      // Exceptions datées du 2026-10-28 : écrans hors périmètre de la refonte. Retirer la ligne à la refonte.
      'src/app/dashboard/CreateRestaurantGate.tsx',
      'src/app/dashboard/admin/margin/page.tsx',
      'src/app/dashboard/admin/provisioning/page.tsx',
      'src/app/dashboard/copilot/quality/page.tsx',
      'src/app/dashboard/customers/page.tsx',
      'src/app/dashboard/floor-plan/_components/FloorPlanCanvas.tsx',
      'src/app/dashboard/floor-plan/_components/PlanningTab.tsx',
      'src/app/dashboard/floor-plan/_components/ServiceCopilotSimulator.tsx',
      'src/app/dashboard/usage/page.tsx',
      'src/components/GaugeDial.tsx',
      'src/components/HeroDashboardPreview.tsx',
      'src/components/PwaInstallBanner.tsx',
      'src/components/RouteErrorState.tsx',
      'src/components/gift-cards/gift-card-list.tsx',
      'src/components/reservation/reservation-comparison.tsx',
      'src/components/reservation/reservation-date-picker.tsx',
      'src/components/reservation/reservation-widget.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/(^|\\s)(uppercase|tracking-wide|tracking-wider|tracking-widest|text-\\[10px\\]|text-\\[11px\\])(\\s|$)/]',
          message:
            'Pas de majuscules, de tracking large ni de texte sous 12 px : voir « Style des écrans ».',
        },
        {
          selector:
            'TemplateElement[value.raw=/(^|\\s)(uppercase|tracking-wide|tracking-wider|tracking-widest|text-\\[10px\\]|text-\\[11px\\])(\\s|$)/]',
          message:
            'Pas de majuscules, de tracking large ni de texte sous 12 px : voir « Style des écrans ».',
        },
      ],
    },
  },
  { ignores: ['.next/**', 'out/**', 'dist/**', 'coverage/**', '.turbo/**'] },
];
