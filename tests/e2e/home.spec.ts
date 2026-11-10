/**
 * The signed-out home page: the two ways in, then one sample event on the big
 * screen, a phone, a profile and the console, the events really run here
 * lately, and the way to the demo.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './network-guard';

const RECENT = [
  {
    code: 'EPPVHG',
    name: 'Collectibles Corner Locals',
    place: '',
    startsAt: '2026-11-05T19:30',
    players: 7
  },
  {
    code: 'PQFBVS',
    name: 'Combat Power Locals',
    place: 'Combat Power Gaming · San Antonio, TX',
    startsAt: '2026-10-18T15:00',
    players: 6
  }
];

async function signedOut(page: Page, recent: unknown[] = RECENT) {
  await page.route('**/api/me', route => route.fulfill({ json: { user: null, providers: ['google', 'discord'] } }));
  await page.route('**/api/recent-events', route => route.fulfill({ json: { events: recent } }));
  await page.goto('/');
  await expect(page.locator('.tm-home')).toBeVisible();
}

const START = new Date('2026-10-18T18:00:00');

/** The home page on a stopped clock, which the test then steps through. */
async function signedOutPaused(page: Page) {
  await page.clock.install({ time: START });
  await signedOut(page);
  await page.clock.pauseAt(new Date(START.getTime() + 2000));
}

test('the home page plays a sample event on the big screen, a phone and a profile @mobile', async ({ page }) => {
  await signedOut(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run an event');
  const door = page.locator('.tm-home-door').first();
  await expect(door.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/create-account');
  await expect(door.getByRole('link', { name: 'or sign in' })).toHaveAttribute('href', '/sign-in');
  const screen = page.locator('.tm-hs');
  await expect(screen.locator('.tm-hs-code')).toHaveText('K7RW2P');
  await expect(screen.locator('.tm-hs-tables li')).toHaveCount(6);
  await expect(page.locator('.tm-hp-you')).toContainText('Reese Lundquist');
  await expect(page.locator('.tm-hpr-name')).toContainText('@rosematcha');
});

/** Every way in the server can offer, on a page of its own. */
async function signInOffered(page: Page) {
  await page.route('**/api/me', route =>
    route.fulfill({ json: { user: null, providers: ['google', 'discord', 'clerk'], clerkKey: 'pk_test_x' } })
  );
  await page.route('**/api/recent-events', route => route.fulfill({ json: { events: [] } }));
  await page.goto('/');
}

/** The ways in from the top of the page down, as `ways` lists them. */
async function inOrder(ways: Locator[]) {
  const tops = await Promise.all(ways.map(async way => (await way.boundingBox())!.y));
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
}

test('the organizer’s door makes an account: the providers first, then username, email and password @mobile', async ({
  page
}) => {
  await signInOffered(page);
  await page.locator('.tm-home-door').first().getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/create-account$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create an account');
  await expect(page).toHaveTitle('Create an account — Ciphermaniac Events');
  const google = page.getByRole('link', { name: 'Sign up with Google' });
  await expect(google).toHaveAttribute('href', '/api/auth/login/google?next=%2F');
  const discord = page.getByRole('link', { name: 'Sign up with Discord' });
  await inOrder([google, discord, page.getByLabel('Username'), page.getByLabel('Email'), page.getByLabel('Password')]);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  // One column centred in the page, its controls at full size.
  const column = (await page.locator('.tm-auth').boundingBox())!;
  const main = (await page.locator('main').boundingBox())!;
  expect(Math.abs(column.x + column.width / 2 - (main.x + main.width / 2))).toBeLessThan(1);
  for (const control of [google, page.getByLabel('Username'), page.getByRole('button', { name: 'Create account' })]) {
    expect(Math.round((await control.boundingBox())!.height)).toBe(48);
  }
  // Signing in instead is the sign-in page, still headed home.
  await page.getByRole('button', { name: 'I have an account' }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2F$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await expect(page.getByLabel('Email')).toHaveCount(0);
});

test('the organizer’s door signs in: the providers first, then username and password @mobile', async ({ page }) => {
  await signInOffered(page);
  await page.locator('.tm-home-door').first().getByRole('link', { name: 'or sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  const google = page.getByRole('link', { name: 'Sign in with Google' });
  await expect(google).toHaveAttribute('href', '/api/auth/login/google?next=%2F');
  await inOrder([google, page.getByRole('link', { name: 'Sign in with Discord' }), page.getByLabel('Username')]);
  // Its own page: the head's way in would only lead back to it.
  await expect(page.locator('.site-head-signin')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/create-account\?next=%2F$/);
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('the sample phone’s Sign in keeps to one line inside its button, in Spanish too @mobile', async ({ page }) => {
  // "Iniciar sesión" is the longest of the site's words for it.
  await signedOut(page);
  await page.goto('/?lang=es');
  const signIn = page.locator('.tm-hp-signin');
  await expect(signIn).toHaveText('Iniciar sesión');
  expect(await signIn.evaluate(button => button.scrollHeight <= button.clientHeight)).toBe(true);
});

test('leaving the home page gives the reader their own mode back', async ({ page }) => {
  await signedOut(page);
  await expect(page.locator('body')).toHaveClass(/tm-home-mode/);
  await page.getByRole('link', { name: 'Privacy' }).first().click();
  await expect(page.locator('body')).not.toHaveClass(/tm-home-mode/);
});

test('a badge on the profile names itself on hover', async ({ page }) => {
  await signedOut(page);
  await page.locator('.tm-hpr .tm-badge').first().hover();
  await expect(page.locator('.tm-hpr').getByText('Developer', { exact: true })).toBeVisible();
});

test('every preview holds its height through a whole sample event and into the next', async ({ page }) => {
  await signedOutPaused(page);
  const surfaces = ['.tm-home-tv', '.tm-home-phone', '.tm-hp-you', '.tm-home-profile', '.tm-home-console'];
  const heights = () =>
    page.evaluate(
      selectors => selectors.map(s => Math.round(document.querySelector(s)?.getBoundingClientRect().height ?? -1)),
      surfaces
    );
  const first = await heights();
  // Five rounds of about four and a half seconds each, the rest, and the next event's opening.
  for (let step = 0; step < 80; step += 1) {
    await page.clock.runFor(400);
    expect(await heights()).toEqual(first);
  }
  await expect(page.locator('.tm-hs-status')).toContainText('Round');
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the sample event rests finished', async ({ page }) => {
    await signedOut(page);
    await expect(page.locator('.tm-hs-status')).toContainText('Round 5 of 5');
  });
});

test('an event code from the player’s door opens that event’s page @mobile', async ({ page }) => {
  await signedOut(page);
  await page.route('**/api/tournaments/K7RW2P*', route =>
    route.fulfill({ status: 404, json: { error: 'No such event' } })
  );
  await page.getByRole('textbox', { name: 'Event code' }).fill(' k7rw2p ');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page).toHaveURL(/\/t\/K7RW2P$/);
});

test('recent events list finished events, each row opening its event', async ({ page }) => {
  await signedOut(page);
  const recent = page.getByRole('region', { name: 'Recent events' });
  const rows = recent.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Collectibles Corner Locals');
  await expect(rows.nth(1)).toContainText('Combat Power Gaming · San Antonio, TX');
  await expect(rows.first().getByRole('link')).toHaveAttribute('href', '/t/EPPVHG');
  await page.route('**/api/tournaments/PQFBVS*', route =>
    route.fulfill({ status: 404, json: { error: 'No such event' } })
  );
  await rows.nth(1).locator('td.num').click();
  await expect(page).toHaveURL(/\/t\/PQFBVS$/);
});

test('with no recent events the section is left out', async ({ page }) => {
  await signedOut(page, []);
  await expect(page.getByRole('region', { name: 'At the venue' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent events' })).toHaveCount(0);
});

test('the big screen and the phone stand the same height, and the console is only a picture', async ({ page }) => {
  await signedOut(page);
  const tv = (await page.locator('.tm-home-tv').boundingBox())!;
  const phone = (await page.locator('.tm-home-phone').boundingBox())!;
  expect(Math.abs(tv.height - phone.height)).toBeLessThan(1);
  await expect(page.locator('.tm-home-console')).toHaveAttribute('inert', '');
  await expect(page.getByRole('link', { name: 'Open the demo' })).toHaveAttribute(
    'href',
    'https://demo.events.ciphermaniac.com'
  );
});

test('on a phone the doors stack, the big screen steps aside and nothing scrolls sideways @mobile', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedOut(page);
  await expect(page.locator('.tm-home-tv')).toBeHidden();
  await expect(page.locator('.tm-home-phone')).toBeVisible();
  const doors = page.locator('.tm-home-door');
  const first = (await doors.first().boundingBox())!;
  const second = (await doors.nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
  const signIn = await doors.first().getByRole('link', { name: 'or sign in' }).boundingBox();
  // To the hundredth of a pixel: layout can land a hair under a whole one, as 43.99997.
  expect(Math.round((signIn?.height ?? 0) * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the raised band runs to the window’s edges', async ({ page }) => {
  await signedOut(page);
  const band = (await page.locator('.tm-home-band').boundingBox())!;
  // One pixel at the window's left edge, inside the band's height: the band's fill, not the page's.
  const shot = await page.screenshot({ clip: { x: 0, y: band.y + 20, width: 1, height: 1 } });
  const raised = await page.screenshot({
    clip: { x: band.x + band.width / 2, y: band.y + 4, width: 1, height: 1 }
  });
  expect(shot.equals(raised)).toBe(true);
});
