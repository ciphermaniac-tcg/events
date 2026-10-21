/**
 * What a page shows when the account can't be read: the page's error with a
 * way to try again and a way home, never a bare line or a blank head bar.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

/** The account read fails until `ok` is set; History's own list is empty. */
async function failingSession(page: Page) {
  const state = { ok: false };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      return state.ok
        ? route.fulfill({
            json: { user: { id: 'u1', name: 'Ada', handle: 'ada', role: null, stores: [] }, providers: [] }
          })
        : route.fulfill({ status: 503, body: 'Service Unavailable' });
    }
    return route.fulfill({ json: path === '/api/history' ? { entries: [] } : {} });
  });
  return state;
}

test('a failed account read shows the page’s error, and Try again reads it again', async ({ page }) => {
  const state = await failingSession(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Couldn’t load this page' })).toBeVisible();
  // A 503 with no reason, put in words (see errorText).
  await expect(page.getByRole('alert')).toContainText('The site hit an error.');
  await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  state.ok = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
});
