import { test, expect, type Page } from '@playwright/test';

const RESTAURANT_SLUG = 'chez-sokar-demo';

const DEMO_RESTAURANT = {
  id: 'e2e-demo-restaurant',
  name: 'Chez Sokar',
  openingHours: {
    sun: { open: '12:00', close: '22:00' },
    mon: { open: '12:00', close: '22:00' },
    tue: { open: '12:00', close: '22:00' },
    wed: { open: '12:00', close: '22:00' },
    thu: { open: '12:00', close: '22:00' },
    fri: { open: '12:00', close: '23:00' },
    sat: { open: '12:00', close: '23:00' },
  },
  city: 'Lyon',
  cuisine: 'Bistrot',
  address: '12 Rue de la République, 69001 Lyon',
  giftCardEnabled: true,
};

async function mockDemoApi(page: Page): Promise<void> {
  // The CI dashboard server has no API process. Keep this proof deterministic
  // while staging runs against the real API through the same page proxy.
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  await page.route('**/api/proxy/public/widget/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DEMO_RESTAURANT),
    });
  });

  await page.route('**/api/proxy/restaurants/*/availability**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        restaurantId: DEMO_RESTAURANT.id,
        date: new Date().toISOString().slice(0, 10),
        partySize: 2,
        slots: ['12:00', '19:00'],
      }),
    });
  });
}

test.describe('Widget réservation public', () => {
  test('charge le widget et ses disponibilités sans erreur', async ({ page }) => {
    await mockDemoApi(page);
    // Le widget charge des visuels distants ; attendre `networkidle` rend le
    // smoke flaky sur le runner CI lorsque ces images restent en vol. Les
    // assertions ci-dessous attendent les données et l'interface utile.
    await page.goto(`/widget/${RESTAURANT_SLUG}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Chez Sokar').first()).toBeVisible();
    await expect(page.getByText('Nombre de personnes')).toBeVisible();
    await expect(page.getByText('Sélectionner la date')).toBeVisible();
    await expect(page.getByText('Créneau horaire')).toBeVisible();

    // Les états « aucun service », « complet » et les créneaux sont légitimes
    // selon le jour. Une erreur d'appel API ne l'est pas.
    await expect(page.getByText('Disponibilités indisponibles.')).toHaveCount(0);
    await expect(
      page.getByText(/Aucun service ce jour-là|Complet ce jour-là|Déjeuner|Dîner/).first(),
    ).toBeVisible();

    const availableDate = page.getByRole('button', { name: /\bdisponible$/i }).first();
    await expect(availableDate).toBeVisible();
    await availableDate.click();
    await expect(page.getByText('Créneau horaire')).toBeVisible();
  });
});
