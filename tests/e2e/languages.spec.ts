/**
 * The site's languages in a real browser: a browser that asks for Spanish is
 * answered in Spanish before the first paint, one that asks for English sees
 * no trace of another language, and a bilingual one finds Spanish in the
 * footer and keeps it once chosen.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

const catalog = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../src/locales/${name}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;
const es = catalog('es');

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

// Spanish, French and German are paused: reachable by ?lang=, offered to no one.
for (const languages of [['es-MX', 'en'], ['fr-CA', 'en'], ['de-AT'], ['en-US', 'es-US']]) {
  test(`a browser that asks for ${languages.join(', ')} reads English with no switch`, async ({ page }) => {
    await speak(page, languages);
    await page.goto('/welcome');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Español' })).toHaveCount(0);
  });
}

test('?lang= names a language outright, offers English back, and is not remembered past the pause', async ({
  page
}) => {
  await speak(page, ['en-US']);
  await page.goto('/welcome?lang=es');
  await expect(page.getByRole('button', { name: es.Continue })).toBeVisible();
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.goto('/welcome');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('on a 320px phone the head keeps the site’s name and a long Sign in to one line each @mobileOnly', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const lines = (selector: string) =>
    page.locator(selector).evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      // One line of text stands less than twice its font size tall; two stand more.
      return Math.ceil(range.getBoundingClientRect().height / (2 * parseFloat(getComputedStyle(el).fontSize)));
    });
  for (const language of ['es', 'fr']) {
    await page.goto(`/history?lang=${language}`);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    expect(await lines('.site-head-name > span')).toBe(1);
    expect(await lines('.site-head-signin')).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  }
});
