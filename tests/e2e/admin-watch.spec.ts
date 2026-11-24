/**
 * A site Admin off an event's staff opens its console read only: the tabs
 * move between sections, the round and settings controls are off, and the
 * roster offers nothing that changes a player.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './network-guard';
import type { Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import type { Tournament } from '../../shared/tournament/types';
import { manageOf, organizerMe, runCommands } from './console-fixture';

const CODE = 'WATCH1';

/** Every button under `within`, of which there is at least one, is off. */
async function expectControlsOff(within: Locator) {
  const buttons = await within.locator('button').all();
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    await expect(button).toBeDisabled();
  }
}

const adds: Command[] = Array.from({ length: 4 }, (_, i) => ({
  type: 'addPlayer',
  player: { firstName: `Player${i + 1}`, lastName: 'Test' }
}));

/** Opens the console as an Admin off the staff, watching `tournament`. */
async function watch(page: Page, tournament: Tournament) {
  const manage = manageOf(CODE, tournament, { role: 'staff', staffToken: null, watching: true });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
}

test('an Admin watching sees the console with its controls off', async ({ page }) => {
  await watch(page, runCommands(emptyTournament({ name: 'Friday League' }), ...adds));
  await expect(page.getByText('Read only. You’re not on this event’s staff.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Test, Player1' })).toBeVisible();
  await expectControlsOff(page.locator('fieldset.tm-readonly'));
  await expect(page.getByRole('form', { name: 'Add a player' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More for Player1 Test' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.locator('fieldset.tm-readonly')).toHaveCount(2);
  await expectControlsOff(page.locator('fieldset.tm-readonly'));
});

test('a watching Admin’s fields read as off: no fill, a pale edge, muted text', async ({ page }) => {
  await watch(page, runCommands(emptyTournament({ name: 'Friday League' }), ...adds));
  await page.getByRole('tab', { name: 'Settings' }).click();
  const name = page.getByRole('textbox', { name: 'Event name' });
  await expect(name).toBeDisabled();
  const look = await name.evaluate(el => {
    const style = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    el.parentElement!.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    return { fill: style.backgroundColor, cursor: style.cursor, text: style.color, muted };
  });
  expect(look).toMatchObject({ fill: 'rgba(0, 0, 0, 0)', cursor: 'not-allowed', text: look.muted });
});

test('an Admin watching on a phone sees the round clock and a late player, with nothing to press', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const late: Command = { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Test' } };
  const paired = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, {
    type: 'pairRound',
    pod: 'masters'
  });
  await watch(page, runCommands(paired, late));
  await expect(page.getByText('Not seated this round: Late Test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-pair to seat them' })).toHaveCount(0);
  const pin = page.locator('.tm-round-pin');
  await expect(pin.getByRole('timer')).toBeVisible();
  await expect(pin.getByRole('group', { name: 'Round clock' })).toHaveCount(0);
});

test('someone off the staff who opens the console lands on the event page', async ({ page }) => {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return route.fulfill({ status: 403, json: { error: 'Only this event’s staff can do that' } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto('/');
  await page.goto(`/host/${CODE}`);
  await expect(page).toHaveURL(`/t/${CODE}`);
  await page.goBack();
  await expect(page).toHaveURL('/');
});
