/**
 * A site Admin off an event's staff opens its console read only: the tabs
 * move between sections, and the round and settings controls are off.
 */
import { expect, type Locator } from '@playwright/test';
import { test } from './network-guard';
import type { Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
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

test('an Admin watching sees the console with its controls off', async ({ page }) => {
  const manage = manageOf(CODE, runCommands(emptyTournament({ name: 'Friday League' }), ...adds), {
    role: 'staff',
    staffToken: null,
    watching: true
  });
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
  await expect(page.getByText('Read only. You’re not on this event’s staff.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Test, Player1' })).toBeVisible();
  await expectControlsOff(page.locator('fieldset.tm-readonly'));
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.locator('fieldset.tm-readonly')).toHaveCount(2);
  await expectControlsOff(page.locator('fieldset.tm-readonly'));
});
