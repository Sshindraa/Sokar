import { test, expect } from '@playwright/test';

test('privacy renders with the request CSP nonce after hydration', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/privacy');
  expect(response?.status()).toBe(200);
  const csp = response?.headers()['content-security-policy'] ?? '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const html = await response!.text();
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    ([, attributes]) => !/\bsrc=/i.test(attributes),
  );
  expect(inlineScripts.length).toBeGreaterThan(0);
  for (const [, attributes] of inlineScripts) {
    expect(attributes).toContain(`nonce="${nonce}"`);
  }
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('heading', { name: 'Politique de confidentialité', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
