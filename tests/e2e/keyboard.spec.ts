/**
 * Getting around by keyboard (src/app.tsx): the first Tab
 * reaches a skip link to the page's content, and a new page starts focus on
 * its content rather than on the link left behind. (A change of query alone
 * leaves focus where it was: the tabs keep it, tournament-console.spec.ts.)
 * A link inside a sentence is underlined.
 */

import { expect } from '@playwright/test';
import { test } from './network-guard';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    await (pathname === '/api/me'
      ? route.fulfill({ json: { user: null, providers: ['google'] } })
      : route.fulfill({ status: 404, json: { error: 'Not mocked' } }));
  });
});

test('the first Tab reaches the skip link, which moves focus to the content', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).not.toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/privacy$/);
});

test('a new page starts focus on its content', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  const terms = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Terms' });
  await terms.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
});

test('the footer’s link in its sentence is underlined, not told apart by colour alone', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('link', { name: '@dustoxgDP63' })).toHaveCSS('text-decoration-line', 'underline');
});
