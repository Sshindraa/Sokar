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

async function mockDemoApi(page: Page, partySize = 2, slots = ['12:00', '19:00']): Promise<void> {
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
    const requestUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        restaurantId: DEMO_RESTAURANT.id,
        date: requestUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10),
        partySize,
        slots,
      }),
    });
  });
}

test.describe('Widget réservation public', () => {
  test('reprend depuis /book la date, le groupe et le créneau vérifié', async ({ page }) => {
    test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'Scénario déterministe local uniquement');
    await mockDemoApi(page, 4, ['20:00', '20:30']);
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    await page.goto(
      `/book/${RESTAURANT_SLUG}?source=restaurant&date=${date}&time=20:30&partySize=4`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect(page.getByText('Chez Sokar').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '4 personnes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Choisir le créneau 20h30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: /Continuer · 20h30/ })).toBeVisible();
  });

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

    const openDate = page.getByRole('button', { name: /\bouvert$/i }).first();
    await expect(openDate).toBeVisible();
    await openDate.click();
    await expect(page.getByRole('button', { name: 'Choisir le créneau 12h00' })).toBeVisible();
  });

  test('préserve les coordonnées au retour et confirme après le succès API', async ({ page }) => {
    let reservationPayload: Record<string, unknown> | undefined;
    await page.route('**/api/proxy/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.pathname.endsWith('/reservations')) {
        reservationPayload = request.postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'e2e-confirmed-reservation',
            restaurantId: DEMO_RESTAURANT.id,
            reservedAt: reservationPayload.reservedAt,
            partySize: reservationPayload.partySize,
            customerName: reservationPayload.customerName,
            customerPhone: reservationPayload.customerPhone,
            status: 'CONFIRMED',
          }),
        });
        return;
      }
      await route.fallback();
    });
    await mockDemoApi(page, 5, ['20:00', '20:30']);

    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateParam = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const tomorrowLabel = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Paris',
    }).format(tomorrow);

    await page.goto(
      `/book/${RESTAURANT_SLUG}?source=restaurant&date=${date}&time=20:30&partySize=4`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.getByRole('button', { name: /Continuer · 20h30/ })).toBeVisible();
    await page.getByRole('button', { name: /Continuer · 20h30/ }).click();

    const customerName = page.getByLabel('Nom complet *');
    const customerPhone = page.getByLabel('Téléphone *');
    await customerName.fill('Alice Martin');
    await customerPhone.fill('0600000000');
    await page.getByRole('button', { name: 'Retour aux créneaux' }).click();

    const groupAvailability = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/availability') &&
        url.searchParams.get('date') === date &&
        url.searchParams.get('partySize') === '5'
      );
    });
    await page.getByRole('button', { name: '5 personnes' }).click();
    await groupAvailability;
    const slotAfterGroupChange = page.getByRole('button', { name: 'Choisir le créneau 20h30' });
    await expect(slotAfterGroupChange).toHaveAttribute('aria-pressed', 'false');
    const tomorrowDate = page.getByRole('button', {
      name: new RegExp(`${tomorrowLabel} ouvert`, 'i'),
    });
    const tomorrowAvailability = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/availability') &&
        url.searchParams.get('date') === tomorrowDateParam &&
        url.searchParams.get('partySize') === '5'
      );
    });
    await tomorrowDate.click();
    await tomorrowAvailability;
    const verifiedTomorrowSlot = page.getByRole('button', { name: 'Choisir le créneau 20h30' });
    await expect(verifiedTomorrowSlot).toBeVisible();
    await expect(verifiedTomorrowSlot).toHaveAttribute('aria-pressed', 'false');
    await verifiedTomorrowSlot.click();
    await page.getByRole('button', { name: /Continuer · 20h30/ }).click();

    await expect(customerName).toHaveValue('Alice Martin');
    await expect(customerPhone).toHaveValue('0600000000');
    await page.getByRole('button', { name: 'Valider la réservation' }).click();
    await expect(page.getByRole('heading', { name: 'Table réservée !' })).toBeVisible();
    expect(reservationPayload).toMatchObject({
      partySize: 5,
      customerName: 'Alice Martin',
      customerPhone: '+33600000000',
    });
    expect(reservationPayload?.reservedAt).toBeTruthy();
  });
});
