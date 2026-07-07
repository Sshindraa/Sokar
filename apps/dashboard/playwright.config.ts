import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright pour le dashboard Sokar.
 *
 * Garde-fou non-régression : vérifie que /dashboard se charge sans erreur sur
 * 3 viewports (iPhone 14, iPad Mini, desktop 1440px), que le header analytics
 * ne chevauche pas les widgets (incident 2026-07), et que les KPIs/graphiques
 * s'affichent.
 *
 * Le dashboard tourne en dev sans clé Clerk (middleware bypass) → le rendu
 * utilise les données de démo (DEMO_ANALYTICS_BY_PERIOD), aucune API requise.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'iphone-14',
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
      use: {
        ...devices['iPad Mini'],
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    command: 'npx next dev',
    url: 'http://localhost:3000/dashboard',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
