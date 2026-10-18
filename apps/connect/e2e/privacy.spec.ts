import { test, expect } from '@playwright/test';

for (const width of [390, 820, 1440]) {
  test(`public privacy notice stays readable and nontechnical at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/privacy');
    const article = page.getByRole('article', { name: 'Politique de confidentialité' });
    await expect(article.getByText('Gestion des comptes', { exact: true })).toBeVisible();
    await expect(article).toContainText('hors de l’Espace économique européen');
    await expect(article).toContainText('sans purge automatique');
    await expect(article).not.toContainText(
      /Clerk|Resend|Google Workspace|Cerebras|OpenRouter|Respan|PostgreSQL|Redis/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const href of await page
      .locator('nav a[href^="#"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))) {
      await expect(page.locator(href)).toHaveCount(1);
    }
  });
}

test('privacy renders with the request CSP nonce after hydration', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/privacy');
  expect(response?.status()).toBe(200);
  const csp = response?.headers()['content-security-policy'] ?? '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  await page.waitForLoadState('networkidle');
  // Inspect the server document, excluding scripts injected later by the dev overlay.
  const scriptNonces = await page.evaluate(
    (html) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      return [...document.querySelectorAll<HTMLScriptElement>('script:not([src])')].map(
        (script) => script.nonce,
      );
    },
    await response!.text(),
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  for (const scriptNonce of scriptNonces) expect(scriptNonce).toBe(nonce);
  await expect(
    page.getByRole('heading', { name: 'Politique de confidentialité', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
