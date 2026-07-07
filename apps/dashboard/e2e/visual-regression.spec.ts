import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * Tests de régression visuelle — Phase 2 du plan qualité Sokar.
 *
 * Pour chaque page critique et chaque viewport (iPhone 14, iPad Mini, desktop
 * 1440px), on capture un screenshot et on le compare au baseline stocké dans
 * `e2e/__snapshots__/`. Seuil de tolérance : 0.2 % de diff pixel.
 *
 * Pages testées :
 *  - /dashboard              — cockpit avec données de démo (sans Clerk)
 *  - /dashboard/reservations — skeleton (loading sans Clerk, état stable)
 *  - /dashboard/calls        — skeleton
 *  - /dashboard/gift-cards   — skeleton
 *  - /                       — homepage marketing (hero section)
 *  - /pricing                — page tarifs
 *
 * Stabilité :
 *  - `animations: 'disabled'` + `reducedMotion: 'reduce'` (config projet) →
 *    framer-motion skip les animations, CSS animations neutralisées.
 *  - `stylePath` injecte un CSS qui désactive les transitions et masque le
 *    caret texte.
 *  - `waitUntil: 'networkidle'` + attente d'un sélecteur stable avant capture.
 *  - Les pages dashboard sans Clerk affichent les données de démo ou un
 *    skeleton — pas de contenu aléatoire ni d'appel API.
 *
 * Mettre à jour les baselines après un changement visuel intentionnel :
 *   pnpm test:visual -- --update-snapshots
 * Puis review le diff dans `e2e/__snapshots__/` et committer.
 */

const STABILITY_CSS = path.resolve(__dirname, 'visual-stability.css');

interface VisualPage {
  name: string;
  url: string;
  /** Sélecteur Playwright à attendre avant de capturer le screenshot. */
  waitFor: string;
  /** Temps d'attente supplémentaire (ms) après le sélecteur pour laisser les
   * composants dynamiques (recharts, framer-motion) atteindre leur état final. */
  settleMs?: number;
}

const PAGES: VisualPage[] = [
  {
    name: 'dashboard',
    url: '/dashboard',
    // Le heading "Ce que Sokar vous rapporte" apparaît une fois les données de
    // démo chargées. On attend aussi .recharts-surface pour les graphiques.
    waitFor: 'h1:has-text("Ce que Sokar vous rapporte")',
    settleMs: 1000,
  },
  {
    name: 'dashboard-reservations',
    url: '/dashboard/reservations',
    // Sans Clerk, la page reste en skeleton (loading=true). Le skeleton est
    // un état stable et déterministe.
    waitFor: '.animate-pulse',
    settleMs: 500,
  },
  {
    name: 'dashboard-calls',
    url: '/dashboard/calls',
    waitFor: '.animate-pulse',
    settleMs: 500,
  },
  {
    name: 'dashboard-gift-cards',
    url: '/dashboard/gift-cards',
    waitFor: '.animate-pulse',
    settleMs: 500,
  },
  {
    name: 'homepage',
    url: '/',
    // Le hero de la homepage contient le h1 "L'IA devient le nouveau levier".
    // On attend ce heading pour s'assurer que le hero est rendu.
    waitFor: 'h1:has-text("nouveau levier")',
    settleMs: 2000,
  },
  {
    name: 'pricing',
    url: '/pricing',
    // La page tarifs a un h1 "Tarifs" avec la classe pricing-hero-title.
    waitFor: '.pricing-hero-title',
    settleMs: 2000,
  },
];

test.describe('Régression visuelle — pages critiques', () => {
  for (const page of PAGES) {
    test(`${page.name} correspond au baseline`, async ({ page: pwPage }: { page: Page }) => {
      // 1. Naviguer vers la page et attendre que le réseau soit inactif.
      await pwPage.goto(page.url, { waitUntil: 'networkidle' });

      // 2. Attendre que le contenu clé soit rendu (heading, skeleton, etc.).
      await pwPage.waitForSelector(page.waitFor, { state: 'visible', timeout: 15_000 });

      // 3. Laisser les composants dynamiques (recharts, framer-motion) atteindre
      //    leur état final après la désactivation des animations.
      if (page.settleMs) {
        await pwPage.waitForTimeout(page.settleMs);
      }

      // 4. Capturer le screenshot et le comparer au baseline.
      //    - maxDiffPixelRatio: 0.002 (0.2 %) — configurable globalement dans
      //      playwright.config.ts (expect.toHaveScreenshot).
      //    - animations: 'disabled' — neutralise les CSS animations.
      //    - caret: 'hide' — masque le caret texte.
      //    - stylePath: désactive les transitions CSS restantes.
      //    - fullPage: false — capture uniquement le viewport visible (plus
      //      stable qu'un full-page qui dépend du contenu below-the-fold).
      await expect(pwPage).toHaveScreenshot(`${page.name}.png`, {
        maxDiffPixelRatio: 0.002,
        animations: 'disabled',
        caret: 'hide',
        stylePath: STABILITY_CSS,
        fullPage: false,
      });
    });
  }
});
