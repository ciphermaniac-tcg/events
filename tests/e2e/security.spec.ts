import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const headers = readFileSync(new URL('../../static/_headers', import.meta.url), 'utf8');
const policy = headers
  .split('\n')
  .find(line => line.trim().startsWith('Content-Security-Policy:'))
  ?.trim()
  .slice('Content-Security-Policy: '.length);
if (!policy) {
  throw new Error('Missing production CSP');
}
const fixtureOrigin = `http://127.0.0.1:${process.env.E2E_FIXTURE_PORT ?? 4320}`;

// Vite preview omits Pages headers. Apply the production policy, permitting only
// the local fixture origin in addition to its production data sources.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    if (!route.request().isNavigationRequest()) {
      return route.continue();
    }
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'Content-Security-Policy': policy.replace("connect-src 'self'", `connect-src 'self' ${fixtureOrigin}`)
      }
    });
  });
  await page.route('**/api/me', route => route.fulfill({ json: { user: null, providers: [] } }));
});

test('production CSP permits bootstrap scripts and the SPA while blocking injected scripts', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cm:mode', 'dark'));
  const violations: string[] = [];
  await page.exposeFunction('recordViolation', (directive: string) => violations.push(directive));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      void (window as unknown as { recordViolation: (directive: string) => Promise<void> }).recordViolation(
        event.effectiveDirective
      );
    });
  });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'dark');
  expect(violations).toEqual([]);
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'document.body.dataset.injected = "yes"';
    document.head.append(script);
  });
  await expect.poll(() => violations).toContain('script-src-elem');
  await expect(page.locator('body')).not.toHaveAttribute('data-injected');
  // A failed module script exercises the hashed recovery bootstrap; the
  // session guard must survive the reload it causes.
  const reloaded = page.waitForEvent('domcontentloaded');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.type = 'module';
    document.head.append(script);
    script.dispatchEvent(new Event('error'));
  });
  await reloaded;
  expect(await page.evaluate(() => sessionStorage.getItem('cm-shell-recovered'))).toBe('1');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});
