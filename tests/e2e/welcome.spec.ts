/**
 * The age check a new sign-up waits on, against a mocked function: an adult
 * goes on to where sign-in started with the username and name given, a minor
 * is told accounts are for adults with no form left to try again, and a wait
 * that ran out offers sign-in. Signed in, the page is an older account's one
 * offer of a username and name, which Not now turns down.
 */

import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

/** Answers the age check with `status` and `body`, and records what each ask sent. */
async function mockAgeCheck(page: Page, status: number, body: unknown): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/auth/age' && request.method() === 'POST') {
      sent.push(request.postDataJSON());
      await route.fulfill({ status, json: body });
    } else if (pathname === '/api/me') {
      await route.fulfill({ json: { user: null, providers: ['google'] } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Not mocked' } });
    }
  });
  return sent;
}

test('an adult’s birth date goes on to where sign-in started', async ({ page }) => {
  const sent = await mockAgeCheck(page, 200, { next: '/history' });
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your account' })).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel('Username').fill('gato.club');
  await page.getByLabel('First name').fill('Thiago');
  await page.getByLabel('Birth date').fill('1990-06-15');
  await continueButton.click();
  await expect(page).toHaveURL(/\/history$/);
  expect(sent).toEqual([{ handle: 'gato.club', firstName: 'Thiago', lastName: '', birthDate: '1990-06-15' }]);
});

test('a minor is told accounts are for adults, with nothing left to try again', async ({ page }) => {
  await mockAgeCheck(page, 403, { error: 'Ciphermaniac accounts are for people 16 and older.', minor: true });
  await page.goto('/welcome');
  await page.getByLabel('Birth date').fill('2015-01-01');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Ciphermaniac accounts are for people 16 and older.')).toBeVisible();
  await expect(page.getByLabel('Birth date')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});

test('a wait that ran out offers sign-in again', async ({ page }) => {
  await mockAgeCheck(page, 410, { error: 'Please sign in again to continue.' });
  await page.goto('/welcome');
  await page.getByLabel('Birth date').fill('1990-06-15');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Please sign in again to continue.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/settings');
});

test('an older account’s offer of a username and name can be turned down, and goes on', async ({ page }) => {
  const sent: unknown[] = [];
  const user = { id: 'old', name: 'player-ab12cd34', handle: 'player-ab12cd34', firstName: null, lastName: null };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/me/setup') {
      sent.push(request.postDataJSON());
      await route.fulfill({ json: { user } });
    } else if (pathname === '/api/me') {
      await route.fulfill({ json: { user, providers: ['google'] } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Not mocked' } });
    }
  });
  await page.goto('/welcome?next=%2Fhistory');
  await expect(page.getByLabel('Username')).toHaveValue('player-ab12cd34');
  await expect(page.getByLabel('Birth date')).toHaveCount(0);
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page).toHaveURL(/\/history$/);
  expect(sent).toEqual([{}]);
});

test('a new sign-up in a browser still signed in to another account gets the age check', async ({ page }) => {
  const user = { id: 'other', name: 'other', handle: 'other', firstName: null, lastName: null };
  await page.route('**/api/**', route =>
    route.fulfill(
      new URL(route.request().url()).pathname === '/api/me'
        ? { json: { user, providers: ['google'] } }
        : { status: 404, json: { error: 'Not mocked' } }
    )
  );
  await page.goto('/welcome');
  await expect(page.getByLabel('Birth date')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
});
