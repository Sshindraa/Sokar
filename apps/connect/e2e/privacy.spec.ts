import { test, expect } from '@playwright/test';

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
