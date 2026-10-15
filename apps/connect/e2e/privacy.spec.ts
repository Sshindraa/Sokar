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
  const scriptNonces = await page
    .locator('script:not([src])')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  for (const scriptNonce of scriptNonces) expect(scriptNonce).toBe(nonce);
  await expect(
    page.getByRole('heading', { name: 'Politique de confidentialité', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
