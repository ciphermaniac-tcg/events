import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';
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
  const unexpected: string[] = [];
  await page.route('**/api/**', route => {
    unexpected.push(route.request().url());
    return route.fulfill({ status: 500, json: { error: 'Unexpected test request' } });
  });
  await page.route('**/api/admin/applications*', route => route.fulfill({ json: { applications: [] } }));
  await page.route('**/api/applications/mine', route =>
    route.fulfill({ json: { application: null, eligible: { profile: true, email: true } } })
  );
  await page.route('**/api/me', async route => {
    await session.promise;
    await route.fulfill({
      status,
      json: status === 200 ? { user, providers: ['google'] } : { error: 'Session unavailable' }
    });
  });
  await page.route('**/api/tournaments', async route => {
    await dashboard.promise;
    await route.fulfill({ json: { tournaments: [] } });
  });
  await page.route('**/api/history', route => route.fulfill({ json: { entries: [] } }));
  return { session, dashboard, unexpected };
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
        text.push(`${document.title} ${main.textContent ?? ''}`);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  });
});

for (const path of ['/', '/host?tab=organizing']) {
  test(`a signed-in cold load at ${path} stays in its loading state until the dashboard is ready @mobile`, async ({
    page
  }) => {
    const { session, dashboard } = await holdSession(page, USER);
    await page.goto(path);
    await expect(page.locator('.tm-page .skeleton')).toBeVisible();
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
    expect(
      seen.every(text => !/not found|Something went wrong|Couldn’t load|Run your Pokémon|Sign in/.test(text))
    ).toBe(true);
  });
}

test('a signed-out cold load shows the home page only after the session is confirmed @mobile', async ({ page }) => {
  const { session, unexpected } = await holdSession(page, null);
  await page.goto('/');
  await expect(page.locator('.tm-page .skeleton')).toBeVisible();
  await expectLoading(page);
  session.resolve();
  await expect(page.locator('.tm-home')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  // The page's own primary leads; the head bar's way in stays bordered.
  await expect(page.locator('.site-head-signin')).toHaveClass(/btn-secondary/);
  await expect(page.locator('main .skeleton')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('a failed session read is retryable and never pretends the account is signed out @mobile', async ({ page }) => {
  const { session, dashboard, unexpected } = await holdSession(page, null, 503);
  await page.goto('/');
  session.resolve();
  const failed = page.getByRole('alert');
  await expect(failed.getByRole('heading', { name: 'Couldn’t load this page' })).toBeVisible();
  await expect(failed).toContainText('Session unavailable');
  // Already home: the only way on is to try again.
  await expect(failed.getByRole('link', { name: 'Go home' })).toHaveCount(0);
  await expect(page.locator('.tm-home')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  const retry = deferred<void>();
  await page.route('**/api/me', async route => {
    await retry.promise;
    await route.fulfill({ json: { user: USER, providers: ['google'] } });
  });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expectLoading(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  retry.resolve();
  dashboard.resolve();
  await expect(page.getByRole('tabpanel', { name: 'Organizing' })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('an unknown address still shows its actual 404 while the session is pending', async ({ page }) => {
  await holdSession(page, USER);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('main .skeleton')).toHaveCount(0);
});

for (const path of [
  '/settings',
  '/history',
  '/apply',
  '/admin',
  '/stores/one/settings',
  '/stores/join?invite=test',
  '/host/LOAD01'
]) {
  test(`an account page at ${path} waits on the session without a blank or false error @mobile`, async ({ page }) => {
    await holdSession(page, { ...USER, role: 'admin' });
    await page.route('**/api/tournaments/LOAD01/manage*', route =>
      route.fulfill({ status: 403, json: { error: 'Forbidden' } })
    );
    await page.goto(path);
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
    await expectLoading(page);
    await expect(page.locator('main .error-state, main [role=alert]')).toHaveCount(0);
    await expect(page).not.toHaveTitle(/not found/);
  });
}

for (const kind of ['player', 'community', 'admin', 'store staff'] as const) {
  test(`a ${kind} cold load never shows the crash fallback or signed-out content @mobile`, async ({ page }) => {
    const role = kind === 'admin' ? 'admin' : kind === 'community' ? 'community' : null;
    const stores =
      kind === 'store staff'
        ? [
            {
              id: 'store-1',
              name: 'Store',
              leagueId: '123',
              status: 'active' as const,
              timeZone: 'America/Chicago',
              role: 'staff' as const
            }
          ]
        : [];
    const { session, dashboard, unexpected } = await holdSession(page, { ...USER, role, stores });
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
    session.resolve();
    dashboard.resolve();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { initialLoadText: string[] }).initialLoadText);
    expect(seen.every(text => !/not found|Something went wrong|Run your Pokémon|Sign in/.test(text))).toBe(true);
    expect(unexpected).toEqual([]);
  });
}

test('a failed background session refresh keeps the last confirmed account and page', async ({ page }) => {
  const { session, dashboard, unexpected } = await holdSession(page, { ...USER, role: null });
  let reads = 0;
  await page.route('**/api/me', route => {
    reads += 1;
    return route.fulfill({
      status: reads === 1 ? 200 : 503,
      json: reads === 1 ? { user: { ...USER, role: null }, providers: ['google'] } : { error: 'Unavailable' }
    });
  });
  await page.route('**/api/applications/mine', route =>
    route.fulfill({
      json: {
        application: {
          id: 'approved',
          status: 'approved',
          explanation: '',
          createdAt: 0,
          decidedAt: 0,
          note: null,
          store: null
        },
        eligible: { profile: true, email: true }
      }
    })
  );
  await page.goto('/');
  session.resolve();
  dashboard.resolve();
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await expect(page.locator('main .error-state, main [role=alert], .tm-home')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('a failed event list is retryable and never renders an invented empty list', async ({ page }) => {
  const { session, unexpected } = await holdSession(page, { ...USER, role: null });
  await page.route('**/api/tournaments', route =>
    route.fulfill({ status: 503, json: { error: 'Events unavailable' } })
  );
  await page.goto('/');
  session.resolve();
  await expect(page.getByRole('tabpanel', { name: 'Playing' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Organizing' }).click();
  await expect(page.getByRole('alert')).toHaveText('Events unavailable');
  await expect(page.getByText('No events yet')).toHaveCount(0);
  const retry = deferred<void>();
  await page.route('**/api/tournaments', async route => {
    await retry.promise;
    await route.fulfill({ json: { tournaments: [] } });
  });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main .skeleton')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  retry.resolve();
  await expect(page.getByRole('tabpanel', { name: 'Playing' })).toBeVisible();
  expect(unexpected).toEqual([]);
});
