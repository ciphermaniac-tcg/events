import { expect, type Page, test } from '@playwright/test';
import type { Me } from '../../src/lib/tournament/api';
import { deferred } from '../__utils__/deferred';

const USER: Me = {
  id: 'initial-load',
  name: 'Initial Load',
  handle: 'initial-load',
  avatar: null,
  popId: null,
  firstName: null,
  lastName: null,
  birthDate: null,
  role: 'community',
  publicProfile: false,
  profileName: 'handle',
  providers: ['google'],
  stores: []
};

async function holdSession(page: Page, user: Me | null, status = 200) {
  const session = deferred<void>();
  const dashboard = deferred<void>();
  await page.route('**/api/me', async route => {
    await session.promise;
    await route.fulfill({ status, json: { user, providers: ['google'] } });
  });
  await page.route('**/api/tournaments', async route => {
    await dashboard.promise;
    await route.fulfill({ json: { tournaments: [] } });
  });
  await page.route('**/api/history', route => route.fulfill({ json: { entries: [] } }));
  return { session, dashboard };
}

async function expectLoading(page: Page) {
  await expect(page.locator('main .skeleton').first()).toBeVisible();
  await expect(page.locator('.site-footer')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  await expect(page.locator('.tm-home')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const text: string[] = [];
    Object.assign(window, { initialLoadText: text });
    new MutationObserver(() => {
      const main = document.querySelector('main');
      if (main) {
        text.push(main.textContent ?? '');
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
});

for (const path of ['/', '/host?tab=organizing']) {
  test(`a signed-in cold load at ${path} stays in its loading state until the dashboard is ready @mobile`, async ({
    page
  }) => {
    const { session, dashboard } = await holdSession(page, USER);
    await page.goto(path);
    await expect(page.locator('.tm-page > .skeleton')).toBeVisible();
    await expectLoading(page);
    session.resolve();
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
    await expectLoading(page);
    dashboard.resolve();
    await expect(page.getByRole('tabpanel', { name: 'Organizing' })).toBeVisible();
    await expect(page.locator('main .skeleton')).toHaveCount(0);
    await expect(page).toHaveURL(path === '/' ? /\/$/ : /\/\?tab=organizing$/);
    const seen = await page.evaluate(() => (window as unknown as { initialLoadText: string[] }).initialLoadText);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(text => !/Page not found|Run your Pokémon|Sign in/.test(text))).toBe(true);
  });
}

for (const status of [200, 503]) {
  test(`a signed-out cold load with session status ${status} shows the home page after loading @mobile`, async ({
    page
  }) => {
    const { session } = await holdSession(page, null, status);
    await page.goto('/');
    await expect(page.locator('.tm-page > .skeleton')).toBeVisible();
    await expectLoading(page);
    session.resolve();
    await expect(page.locator('.tm-home')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('main .skeleton')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  });
}

test('an unknown address still shows its actual 404 while the session is pending', async ({ page }) => {
  await holdSession(page, USER);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('main .skeleton')).toHaveCount(0);
});
