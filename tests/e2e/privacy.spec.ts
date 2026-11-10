/**
 * The privacy policy and terms of service: their pages draw signed out, and
 * the age check a new sign-up waits on links to both before any account exists.
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

test('the policy reads signed out, with its contact address', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Information we keep',
    'How your information is used',
    'Your control over your information',
    'Changes and questions'
  ]);
  await expect(page.getByRole('link', { name: 'privacy@ciphermaniac.com' })).toHaveAttribute(
    'href',
    'mailto:privacy@ciphermaniac.com'
  );
  await expect(page).toHaveTitle('Privacy Policy — Ciphermaniac Events');
});

test('the policy’s My Data link opens Your data and Export', async ({ page }) => {
  await page.route('**/api/me', route =>
    route.fulfill({
      json: {
        user: {
          id: 'acct-1',
          name: 'Mary Jackson',
          handle: 'mary',
          avatar: null,
          popId: '7200001',
          firstName: 'Mary',
          lastName: 'Jackson',
          birthDate: '02/27/1995',
          role: null,
          publicProfile: false,
          profileName: 'real',
          providers: ['google'],
          stores: []
        },
        providers: ['google']
      }
    })
  );
  await page.goto('/privacy');
  await page.getByRole('link', { name: 'My Data' }).click();
  await expect(page).toHaveURL(/\/settings\?section=data$/);
  await expect(page.getByRole('button', { name: 'Your data' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Your data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export data' })).toBeVisible();
});

test('the terms read signed out, with their contact address', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Using the service',
    'Running events',
    'Results and availability',
    'Ending your use',
    'Changes and questions'
  ]);
  await expect(page.getByRole('link', { name: 'howdy@ciphermaniac.com' })).toHaveAttribute(
    'href',
    'mailto:howdy@ciphermaniac.com'
  );
  await expect(page).toHaveTitle('Terms of Service — Ciphermaniac Events');
});

test('the age check links to the terms', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('link', { name: 'Terms of service' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
});

test('the age check links to the policy', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
});
