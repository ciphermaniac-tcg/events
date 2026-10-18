/**
 * The signed-out home page: one sample event on every surface a real one
 * uses, a console to click around in, Reese's profile, and the features in
 * three rows that drift, stop when pressed, and move by hand.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './network-guard';

async function signedOut(page: Page) {
  await page.route('**/api/me', route => route.fulfill({ json: { user: null, providers: ['google', 'discord'] } }));
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

/** A row's horizontal offset, from its track's transform. */
const offsetOf = (reel: Locator) =>
  reel.locator('.tm-reel-track').evaluate(track => new DOMMatrix(getComputedStyle(track).transform).m41);

test('the home page plays a sample event on the big screen, a phone and a profile @mobile', async ({ page }) => {
  await signedOut(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run your Pokémon TCG events better');
  await expect(page.locator('#sign-in').getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
  const screen = page.locator('.tm-hs');
  await expect(screen.locator('.tm-hs-code')).toHaveText('K7RW2P');
  await expect(screen.locator('.tm-hs-tables li')).toHaveCount(6);
  await expect(page.locator('.tm-hp-you')).toContainText('Reese Lundquist');
  await expect(page.locator('.tm-hpr-name')).toContainText('@rosematcha');
});

test('leaving the home page gives the reader their own mode back', async ({ page }) => {
  await signedOut(page);
  await expect(page.locator('body')).toHaveClass(/tm-home-mode/);
  await page.getByRole('link', { name: 'Privacy' }).first().click();
  await expect(page.locator('body')).not.toHaveClass(/tm-home-mode/);
});

test('the sample console’s tabs open their panels, and In progress keeps only the open tables', async ({ page }) => {
  await signedOutPaused(page);
  const sample = page.getByRole('region', { name: 'A sample admin console' });
  await sample.getByRole('tab', { name: 'Standings' }).click();
  await expect(sample.getByRole('tabpanel').locator('tbody tr')).toHaveCount(10);
  await sample.getByRole('tab', { name: 'Decklists' }).click();
  await expect(sample.getByRole('tabpanel')).toContainText('5 copies of Grand Tree (the limit is 4)');
  await sample.getByRole('tab', { name: 'Pairings' }).click();
  const rows = sample.locator('.tm-hc-pairs tbody tr');
  await expect(rows).toHaveCount(8);
  await sample.getByRole('radio', { name: 'In progress' }).click();
  const reported = Number((await sample.locator('.tm-hc-tally').textContent())?.match(/\d+/)?.[0]);
  await expect(rows).toHaveCount(8 - reported);
  await expect(rows.locator('td:last-child')).toHaveText(Array(8 - reported).fill('—'));
  await page.clock.runFor(330);
  await expect(rows).toHaveCount(Math.max(0, 7 - reported));
});

test('the sample console’s tabs move with the arrow keys', async ({ page }) => {
  await signedOut(page);
  const sample = page.getByRole('region', { name: 'A sample admin console' });
  await expect(sample.getByRole('tablist', { name: 'Event sections' })).toBeVisible();
  await sample.getByRole('tab', { name: 'Pairings' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(sample.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
});

test('a badge on the profile names itself on hover', async ({ page }) => {
  await signedOut(page);
  await page.locator('.tm-hpr .tm-badge').first().hover();
  await expect(page.locator('.tm-hpr').getByText('Developer', { exact: true })).toBeVisible();
});

test('the feature rows drift, stop while pressed, and follow a drag', async ({ page }) => {
  await signedOut(page);
  const reels = page.locator('.tm-reel');
  await expect(reels).toHaveCount(3);
  const reel = reels.first();
  await reel.scrollIntoViewIfNeeded();
  const before = await offsetOf(reel);
  await page.waitForTimeout(500);
  expect(await offsetOf(reel)).not.toBe(before);

  const box = (await reel.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const held = await offsetOf(reel);
  await page.waitForTimeout(400);
  expect(await offsetOf(reel)).toBe(held);
  await page.mouse.move(box.x + box.width / 2 - 120, y, { steps: 6 });
  const dragged = await offsetOf(reel);
  expect(Math.abs(dragged - held)).toBeGreaterThan(60);
  await page.mouse.up();
});

test('every preview holds its height through a whole sample event and into the next', async ({ page }) => {
  await signedOutPaused(page);
  const surfaces = ['.tm-home-tv', '.tm-home-console', '.tm-hp-you', '.tm-hp-list', '.tm-home-profile'];
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

test('a feature row held by keyboard focus stays still, and is named', async ({ page }) => {
  await signedOut(page);
  const reel = page.getByRole('group', { name: 'Features, row 1' });
  await reel.scrollIntoViewIfNeeded();
  // Start the keyboard just before the rows, then Tab into the first.
  await page.locator('#tm-home-features-title').evaluate(heading => {
    heading.setAttribute('tabindex', '-1');
    (heading as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');
  await expect(reel).toBeFocused();
  await page.waitForTimeout(1500);
  const held = await offsetOf(reel);
  await page.waitForTimeout(400);
  expect(Math.abs((await offsetOf(reel)) - held)).toBeLessThan(1);
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the sample event rests finished and the feature rows stay still', async ({ page }) => {
    await signedOut(page);
    await expect(page.locator('.tm-hs-status')).toContainText('Round 5 of 5');
    await page.evaluate(() => document.fonts.ready);
    const reel = page.locator('.tm-reel').first();
    const before = await offsetOf(reel);
    await page.waitForTimeout(500);
    expect(await offsetOf(reel)).toBe(before);
  });
});
