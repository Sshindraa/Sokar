import { test, expect, type Page } from '@playwright/test';

/**
 * Garde-fou non-régression du dashboard Sokar.
 *
 * Contexte : deux incidents client-visibles ont eu lieu en juillet 2026 :
 *  1. Un header analytics chevauchait les widgets à cause d'une règle CSS
 *     globale `header { position: fixed }` dans globals.css.
 *  2. Le dashboard affichait un état Error car toutes les requêtes API étaient
 *     rate-limitées comme venant de 127.0.0.1 (proxy Next.js).
 *
 * Ce test vérifie sur 3 viewports (iPhone 14, iPad Mini, desktop 1440px) que :
 *  - le header analytics ne chevauche pas les widgets (pas de position fixed) ;
 *  - aucun bandeau Error n'est visible ;
 *  - les KPIs et les graphiques s'affichent.
 *
 * En dev sans clé Clerk (middleware bypass), le dashboard utilise les données
 * de démo — aucune API n'est appelée, donc pas de risque de rate-limit 429.
 */

async function loadDashboard(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  // Le skeleton de chargement disparaît quand les données de démo sont prêtes.
  await expect(page.getByRole('heading', { name: 'Pilotage' })).toBeVisible();
}

test.describe('Dashboard /dashboard — stabilité visuelle', () => {
  test.beforeEach(async ({ page }) => {
    await loadDashboard(page);
  });

  test('le header analytics ne chevauche pas les widgets', async ({ page }) => {
    // Le <header> de la page dashboard contient le titre "Pilotage".
    // L'incident venait d'une règle `header { position: fixed }` qui
    // le sortait du flux et le superposait aux KPIs.
    const header = page.locator('header', { hasText: 'Pilotage' });
    await expect(header).toBeVisible();

    // Le header ne doit PAS être en position fixed/absolute (sinon chevauchement).
    const position = await header.evaluate((el) => window.getComputedStyle(el).position);
    expect(position).not.toBe('fixed');
    expect(position).not.toBe('absolute');

    // La première carte KPI doit commencer sous le bas du header.
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();

    const firstWidget = page.getByRole('article', { name: 'Indicateur Réservations' });
    await expect(firstWidget).toBeVisible();
    const widgetBox = await firstWidget.boundingBox();
    expect(widgetBox).not.toBeNull();

    // Le haut du widget doit être >= au bas du header (pas de chevauchement).
    expect(widgetBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  });

  test("aucun bandeau Error n'est visible", async ({ page }) => {
    // L'ErrorState affiche un bouton "Réessayer" et un message d'erreur.
    // En mode démo (sans Clerk), aucune requête API n'échoue → pas d'erreur.
    await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);
    await expect(page.getByText(/Impossible de charger les analytics/)).toHaveCount(0);
  });

  test("les KPIs et graphiques s'affichent", async ({ page }) => {
    // KPIs — labels des cartes KpiCard (exact pour éviter les matches multiples
    // avec d'autres textes comme "des appels reçus").
    await expect(page.getByRole('article', { name: 'Indicateur Réservations' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Indicateur Couverts' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Indicateur CA estimé' })).toBeVisible();

    // Graphiques — DashboardCharts (dynamic import recharts).
    // Les titres des cartes graphique sont rendus une fois recharts hydraté.
    await expect(page.getByRole('heading', { name: 'Réservations et couverts' })).toBeVisible();

    // recharts rend un <svg class="recharts-surface"> — preuve que le graphique
    // est effectivement dessiné (pas juste le conteneur vide).
    await expect(page.locator('.recharts-surface').first()).toBeVisible();
  });
});
