import { expect, test } from '@playwright/test';

/**
 * R0-3 — états dégradés du dashboard.
 *
 * Quand l'API répond 500, une page opérationnelle doit rester lisible et
 * actionnable : état d'erreur inline avec reprise, ou skeleton de chargement.
 * Une page blanche, un écran figé ou l'overlay d'erreur Next.js sont des
 * régressions.
 *
 * Le proxy `/api/proxy/**` est intercepté : aucun appel réel n'est émis.
 */

const CRITICAL_PAGES = [
  { path: '/dashboard/reservations', label: 'Réservations' },
  { path: '/dashboard/calls', label: 'Appels' },
  { path: '/dashboard/customers', label: 'Clients' },
];

test.describe('états dégradés quand l’API répond 500', () => {
  for (const { path, label } of CRITICAL_PAGES) {
    test(`${label} affiche un état exploitable au lieu d’une page blanche`, async ({ page }) => {
      await page.route('**/api/proxy/**', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        }),
      );

      const response = await page.goto(path);

      // La route elle-même doit répondre, pas tomber dans la boundary framework.
      expect(response?.status() ?? 0).toBeLessThan(500);

      await expect(page.getByText(/Application error|Unhandled Runtime Error/i)).toHaveCount(0);

      // Soit un état d'erreur actionnable, soit un skeleton de chargement.
      await expect(
        page.getByRole('alert').or(page.locator('[aria-busy="true"]')).first(),
      ).toBeVisible({ timeout: 20_000 });

      // Le contenu principal reste monté : pas de page vide.
      await expect(page.locator('body')).not.toBeEmpty();
    });
  }
});
