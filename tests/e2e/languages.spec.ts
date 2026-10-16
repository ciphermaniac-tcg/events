/**
 * The site's languages in a real browser: a browser that asks for Spanish is
 * answered in Spanish before the first paint, one that asks for English sees
 * no trace of another language, and a bilingual one finds Spanish in the
 * footer and keeps it once chosen.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

const es = JSON.parse(readFileSync(new URL('../../src/locales/es.json', import.meta.url), 'utf8')) as Record<
  string,
  string
>;

/** The browser's languages, as `navigator.languages` reports them. */
async function speak(page: Page, languages: string[]): Promise<void> {
  await page.addInitScript(list => {
    Object.defineProperty(navigator, 'languages', { get: () => list });
    Object.defineProperty(navigator, 'language', { get: () => list[0] });
  }, languages);
}

async function signedOut(page: Page): Promise<void> {
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/me') {
      await route.fulfill({ json: { user: null, providers: ['google'] } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Not mocked' } });
    }
  });
}

test.beforeEach(async ({ page }) => signedOut(page));

test('a browser that puts Spanish first reads the site in Spanish', async ({ page }) => {
  await speak(page, ['es-MX', 'en']);
  await page.goto('/welcome');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('button', { name: es.Continue })).toBeVisible();
  await expect(page.getByRole('link', { name: 'English' })).toBeVisible();
});

test('an English browser sees no language switch at all', async ({ page }) => {
  await speak(page, ['en-US', 'de']);
  await page.goto('/welcome');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Español' })).toHaveCount(0);
});

test('a bilingual browser stays in English, finds Spanish in the footer, and keeps it', async ({ page }) => {
  await speak(page, ['en-US', 'es-US']);
  await page.goto('/welcome');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.getByRole('link', { name: 'Español' }).click();
  await expect(page.getByRole('button', { name: es.Continue })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
});

test('?lang= names a language outright, whatever the browser asks for', async ({ page }) => {
  await speak(page, ['en-US']);
  await page.goto('/welcome?lang=es');
  await expect(page.getByRole('button', { name: es.Continue })).toBeVisible();
});
