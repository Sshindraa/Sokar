import { expect, test } from '@playwright/test';

test('la synthèse tient dans la fenêtre d’un Mac', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440' || Boolean(process.env.PLAYWRIGHT_BASE_URL));
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.goto('/dashboard', { waitUntil: 'networkidle' });

  const chart = page
    .getByRole('heading', { name: 'Réservations et couverts' })
    .locator('..')
    .locator('..');
  const channels = page.getByRole('region', { name: 'Réservations par canal' });
  await expect(chart).toBeVisible();
  await expect(channels).toBeVisible();
  for (const card of [chart, channels]) {
    const box = await card.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(760);
  }
});
