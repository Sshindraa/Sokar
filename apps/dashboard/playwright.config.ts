import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright pour le dashboard Sokar.
 *
 * Deux familles de tests E2E :
 *
 *  1. Tests fonctionnels (dashboard.spec.ts) — 3 viewports :
 *     - vérifient que /dashboard se charge sans erreur,
 *     - que le header analytics ne chevauche pas les widgets,
 *     - que les KPIs/graphiques s'affichent.
 *
 *  2. Tests de régression visuelle (visual-regression.spec.ts) — 3 viewports :
 *     - capturent un screenshot de 6 pages critiques et le comparent à un
 *       baseline stocké dans e2e/__snapshots__/.
 *     - seuil de tolérance : 0.2 % de diff pixel (maxDiffPixelRatio: 0.002).
 *     - `pnpm test:visual` pour lancer uniquement ces tests.
 *     - `pnpm test:visual -- --update-snapshots` pour régénérer les baselines
 *       après un changement visuel intentionnel.
 *
 * Le dashboard tourne en dev sans clé Clerk (middleware bypass) → le rendu
 * utilise les données de démo (DEMO_ANALYTICS_BY_PERIOD), aucune API requise.
 * Les sous-pages (/dashboard/reservations, /calls, /gift-cards) restent en
 * état skeleton (loading) sans Clerk — c'est un état stable et déterministe.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    // Seuil de tolérance pour les screenshots de régression visuelle :
    // 0.2 % de pixels peuvent différer entre le screenshot capturé et le
    // baseline. Cf. `maxDiffPixelRatio` dans toHaveScreenshot().
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
    },
  },

  // Les baselines sont stockés dans e2e/__snapshots__/ (via snapshotDir).
  // Playwright ajoute un suffixe plateforme (-darwin, -linux) par défaut.
  // En CI, un script copie les baselines -darwin vers -linux avant l'exécution
  // (voir ci.yml). Le seuil de 0.2 % absorbe les micro-différences de rendu
  // (anti-aliasing des fonts) entre plateformes.
  snapshotDir: 'e2e/__snapshots__',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // ── Tests fonctionnels (dashboard.spec.ts) ──
    {
      name: 'iphone-14',
      testIgnore: ['visual-regression.spec.ts'],
      use: {
        ...devices['iPhone 14'],
        // Force chromium : webkit n'est pas installé en CI (poids ~100 Mo).
        // L'émulation mobile (viewport + touch + UA) suffit pour valider le
        // rendu responsive du dashboard.
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'ipad-mini',
      testIgnore: ['visual-regression.spec.ts'],
      use: {
        ...devices['iPad Mini'],
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'desktop-1440',
      testIgnore: ['visual-regression.spec.ts'],
      use: { viewport: { width: 1440, height: 900 } },
    },

    // ── Tests de régression visuelle (visual-regression.spec.ts) ──
    // Les animations sont désactivées via `animations: 'disabled'` dans
    // expect.toHaveScreenshot + le CSS `e2e/visual-stability.css` injecté via
    // `stylePath` dans le test, qui neutralise aussi les transitions CSS.
    {
      name: 'visual-iphone-14',
      testMatch: ['visual-regression.spec.ts'],
      use: {
        ...devices['iPhone 14'],
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'visual-ipad-mini',
      testMatch: ['visual-regression.spec.ts'],
      use: {
        ...devices['iPad Mini'],
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'visual-desktop-1440',
      testMatch: ['visual-regression.spec.ts'],
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    command: 'pnpm next dev',
    url: 'http://localhost:3000/dashboard',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
