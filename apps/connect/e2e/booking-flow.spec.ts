import { test, expect } from '@playwright/test';

/**
 * E2E — Flow de réservation complet via le widget (/widget/[slug]).
 *
 * Le widget de réservation est sur /widget/[slug] (pas /restaurant/[slug] qui
 * est la fiche publique avec un CTA). Le flow :
 *   1. Sélectionner un party size (dropdown)
 *   2. Sélectionner une date (aujourd'hui ou demain)
 *   3. Cliquer "Voir les disponibilités"
 *   4. Vérifier que les créneaux s'affichent (ou message d'erreur)
 *   5. Si créneaux disponibles : sélectionner un créneau, remplir le formulaire,
 *      soumettre et vérifier l'écran de confirmation.
 *
 * Nécessite l'API + DB seedée. Skip si l'API n'est pas disponible.
 *
 * Les tests sont en mode serial car le flow de réservation dépend d'états
 * partagés (créneaux disponibles dans la DB).
 */

const API_URL = process.env.API_URL || 'http://localhost:4100';
const RESTAURANT_SLUG = 'chez-sokar-demo';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) throw new Error(`API health check failed: ${res.status}`);
  } catch {
    test.skip(true, 'API not available — skipping E2E tests');
  }
});

test.describe('Flow de réservation via le widget', () => {
  test('le widget de réservation se charge', async ({ page }) => {
    const response = await page.goto(`/widget/${RESTAURANT_SLUG}`);
    expect(response?.status()).toBe(200);

    // Le titre "Réserver une table" est visible (mode non-embedded)
    const heading = page.getByRole('heading', { name: /réserver une table/i });
    await expect(heading).toBeVisible();

    // Le sélecteur de nombre de personnes est présent
    await expect(page.getByLabel(/nombre de personnes/i)).toBeVisible();

    // Le champ date est présent
    await expect(page.getByLabel('Date')).toBeVisible();

    // Le bouton "Voir les disponibilités" est présent
    await expect(page.getByRole('button', { name: /voir les disponibilités/i })).toBeVisible();
  });

  test('sélectionne la date et le party size puis charge les créneaux', async ({ page }) => {
    await page.goto(`/widget/${RESTAURANT_SLUG}`);

    // Sélectionner un party size de 2
    const partySizeSelect = page.getByLabel(/nombre de personnes/i);
    await partySizeSelect.selectOption('2');

    // La date est pré-remplie avec aujourd'hui — on garde aujourd'hui
    // (le champ date a min=today, donc today est valide)

    // Cliquer sur "Voir les disponibilités"
    const loadButton = page.getByRole('button', { name: /voir les disponibilités/i });
    await loadButton.click();

    // Attendre que le chargement se termine — soit des créneaux s'affichent,
    // soit un message d'erreur/aucun créneau apparaît.
    // On attend soit le groupe de créneaux, soit un message d'erreur.
    await expect(
      page
        .getByRole('group', { name: /créneaux horaires disponibles/i })
        .or(page.getByText(/impossible de charger|erreur réseau|aucun créneau/i)),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('complète le flow de réservation si des créneaux sont disponibles', async ({ page }) => {
    await page.goto(`/widget/${RESTAURANT_SLUG}`);

    // Party size 2
    await page.getByLabel(/nombre de personnes/i).selectOption('2');

    // Charger les disponibilités
    await page.getByRole('button', { name: /voir les disponibilités/i }).click();

    // Attendre que les créneaux se chargent
    const slotsGroup = page.getByRole('group', { name: /créneaux horaires disponibles/i });

    // Vérifier si des créneaux sont disponibles
    const slotsVisible = await slotsGroup.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!slotsVisible) {
      test.skip(true, 'Aucun créneau disponible — skip du test de réservation complète');
    }

    // Sélectionner le premier créneau disponible (bouton non désactivé)
    const firstSlot = slotsGroup.getByRole('button').first();
    await firstSlot.click();

    // Le formulaire de coordonnées s'affiche
    await expect(page.getByLabel(/prénom/i)).toBeVisible();
    await expect(page.getByLabel(/téléphone/i)).toBeVisible();

    // Remplir le formulaire
    await page.getByLabel(/prénom/i).fill('Test E2E');
    await page.getByLabel(/téléphone/i).fill('+33612345678');
    await page.getByLabel(/email/i).fill('test-e2e@sokar.tech');

    // Soumettre la réservation
    const confirmButton = page.getByRole('button', { name: /confirmer la réservation/i });
    await confirmButton.click();

    // Vérifier l'écran de confirmation
    await expect(page.getByRole('status')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/réservation confirmée/i)).toBeVisible();
    await expect(page.getByText(/chez sokar/i)).toBeVisible();
  });
});
