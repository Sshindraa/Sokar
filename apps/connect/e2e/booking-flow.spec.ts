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
 * Nécessite l'API + DB seedée. Skippée si l'API n'est pas disponible.
 *
 * Les tests sont en mode serial car le flow de réservation dépend d'états
 * partagés (créneaux disponibles dans la DB).
 */

const API_URL = process.env.API_URL || 'http://localhost:4000';
const RESTAURANT_SLUG = 'chez-sokar-demo';
const DEMO_DATE_LOOKAHEAD_DAYS = 14;

type AvailabilityResponse = {
  slots?: Array<{ available?: boolean }>;
};

async function findNextAvailableDemoDate(): Promise<string> {
  const today = new Date();
  for (let offset = 1; offset <= DEMO_DATE_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = new Date(today);
    candidate.setUTCDate(today.getUTCDate() + offset);
    const date = candidate.toISOString().slice(0, 10);

    try {
      const response = await fetch(
        `${API_URL}/public/r/${RESTAURANT_SLUG}/availability?date=${date}&partySize=2`,
      );
      if (!response.ok) continue;

      const data = (await response.json()) as AvailabilityResponse;
      if (data.slots?.some((slot) => slot.available === true)) {
        return date;
      }
    } catch {
      // Let the final diagnostic below explain that no usable fixture was found.
    }
  }

  throw new Error(
    `Aucun créneau disponible pour ${RESTAURANT_SLUG} dans les ${DEMO_DATE_LOOKAHEAD_DAYS} prochains jours.`,
  );
}

test.describe.configure({ mode: 'serial' });

let apiAvailable = false;
let demoServiceDate: string | undefined;
test.beforeAll(async () => {
  try {
    const res = await fetch(`${API_URL}/health`);
    apiAvailable = res.ok;
  } catch {
    apiAvailable = false;
  }

  // En CI, l'API et la base seedée sont fournies par le job : une API
  // injoignable est une panne d'infrastructure, pas une raison de sauter les
  // tests.
  if (!apiAvailable && process.env.CI) {
    throw new Error(`API Sokar indisponible sur ${API_URL} : le job CI doit la démarrer.`);
  }

  if (apiAvailable) {
    demoServiceDate = await findNextAvailableDemoDate();
  }
});

test.beforeEach(() => {
  test.skip(!apiAvailable && !process.env.CI, `API Sokar indisponible sur ${API_URL}`);
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

    // Choisir le prochain jour réellement disponible rend le test indépendant
    // du jour où la CI s'exécute et des réservations déjà présentes.
    await page.getByLabel('Date').fill(demoServiceDate ?? '');

    // Cliquer sur "Voir les disponibilités"
    const loadButton = page.getByRole('button', { name: /voir les disponibilités/i });
    await loadButton.click();

    // Attendre que le chargement se termine — soit des créneaux s'affichent,
    // soit un message d'erreur/aucun créneau apparaît.
    // On attend soit le groupe de créneaux, soit un message d'erreur.
    await expect(
      page
        .getByRole('group', { name: /créneaux horaires disponibles/i })
        .or(page.getByText(/impossible de charger|erreur réseau|aucun créneau/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('complète le flow de réservation si des créneaux sont disponibles', async ({ page }) => {
    await page.goto(`/widget/${RESTAURANT_SLUG}`);

    // Party size 2
    await page.getByLabel(/nombre de personnes/i).selectOption('2');
    await page.getByLabel('Date').fill(demoServiceDate ?? '');

    // Charger les disponibilités
    await page.getByRole('button', { name: /voir les disponibilités/i }).click();

    // `locator.isVisible()` ne patiente pas, même si un timeout lui est passé.
    // Attendre explicitement un état final évite de lire le DOM pendant le fetch.
    const slotsGroup = page.getByRole('group', { name: /créneaux horaires disponibles/i });
    await expect(
      slotsGroup
        .or(page.getByRole('status'))
        .or(page.getByText(/impossible de charger|erreur réseau/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Vérifier si des créneaux sont disponibles
    const slotsVisible = await slotsGroup.isVisible();

    if (!slotsVisible) {
      // En local, l'absence de créneaux est fréquente (base non seedée, date
      // fermée). En CI, le job seed le plan de salle : ne rien trouver signifie
      // que le parcours de réservation n'est plus exerçable.
      if (process.env.CI) {
        throw new Error('Aucun créneau disponible en CI — le plan de salle de démo est incomplet.');
      }
      test.skip(true, 'Aucun créneau disponible — skip du test de réservation complète');
    }

    // Sélectionner le premier créneau disponible (bouton non désactivé)
    const firstSlot = slotsGroup.locator('button:not([disabled])').first();
    await expect(firstSlot).toBeVisible();
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
    const confirmation = page.getByRole('status');
    await expect(confirmation).toBeVisible({ timeout: 20_000 });
    await expect(confirmation.getByText(/réservation confirmée/i)).toBeVisible();
    await expect(confirmation.getByText(/chez sokar/i)).toBeVisible();
  });
});
