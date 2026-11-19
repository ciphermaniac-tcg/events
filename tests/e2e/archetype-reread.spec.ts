/**
 * The console's Decklists tab names every pasted list again by the archetype
 * rules as they stand now, and says how many changed.
 */
import { expect } from '@playwright/test';
import { test } from './network-guard';
import type { Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { DEFAULT_SETTINGS, type TournamentSettings } from '../../shared/tournament/view';
import { manageOf, organizerMe, runCommands } from './console-fixture';

const CODE = 'NAMES1';

const adds: Command[] = Array.from({ length: 2 }, (_, i) => ({
  type: 'addPlayer',
  player: { firstName: `Player${i + 1}`, lastName: 'Test' }
}));

const list = (archetype: string, mode: 'digital' | 'paper' = 'digital') => ({
  popId: '',
  firstName: 'Player1',
  lastName: 'Test',
  birthDate: '',
  deck: mode === 'digital' ? '3 Dragapult ex TWM 130\n1 Dusknoir SFA 20' : '',
  mode,
  archetype,
  submittedAt: 0,
  problems: [],
  registered: true,
  fromList: false,
  locked: true
});

test('staff re-read every list’s archetype and see how many changed', async ({ page }) => {
  const manage = manageOf(CODE, runCommands(emptyTournament({ name: 'Friday League' }), ...adds), {
    settings: { ...DEFAULT_SETTINGS, sanctioned: false, decklists: 'open', deckVisibility: 'always' }
  });
  const answers = [1, 0];
  let named = 'Dragapult';
  let reads = 0;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decklists`) {
      reads += 1;
      return route.fulfill({ json: { decklists: [list(named)], mine: null } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/archetypes` && route.request().method() === 'POST') {
      named = 'Dragapult Dusknoir';
      return route.fulfill({ json: { ...manage, renamed: answers.shift() ?? 0 } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  await page.getByRole('tab', { name: 'Decklists' }).click();
  const button = page.getByRole('button', { name: 'Re-read archetypes' });
  await expect(button).toBeVisible();
  const before = reads;
  await button.click();
  await expect(page.getByText('Renamed 1 list.')).toBeVisible();
  // The lists are read again, so each shows the name it now has.
  await expect.poll(() => reads).toBeGreaterThan(before);
  await button.click();
  await expect(page.getByText('No lists changed.')).toBeVisible();
});

test('an event with no pasted lists, or with archetypes off, has nothing to re-read', async ({ page }) => {
  let settings: TournamentSettings = {
    ...DEFAULT_SETTINGS,
    sanctioned: false,
    decklists: 'open',
    deckVisibility: 'always'
  };
  let lists = [list('Rogue', 'paper')];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      const manage = manageOf(CODE, runCommands(emptyTournament({ name: 'Friday League' }), ...adds), { settings });
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { decklists: lists, mine: null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  await page.getByRole('tab', { name: 'Decklists' }).click();
  await expect(page.locator('.tm-lists tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Re-read archetypes' })).toHaveCount(0);

  settings = { ...settings, deckVisibility: 'off' };
  lists = [list('Dragapult')];
  await page.reload();
  await page.getByRole('tab', { name: 'Decklists' }).click();
  await expect(page.locator('.tm-lists tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Re-read archetypes' })).toHaveCount(0);
});

test('on a phone with archetypes off, a list’s name starts its row instead of past an empty deck slot @mobileOnly', async ({
  page
}) => {
  const settings: TournamentSettings = { ...DEFAULT_SETTINGS, decklists: 'open', deckVisibility: 'off' };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      const manage = manageOf(CODE, runCommands(emptyTournament({ name: 'Friday League' }), ...adds), { settings });
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { decklists: [list('Dragapult')], mine: null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  await page.getByRole('tab', { name: 'Decklists' }).click();
  // Measure once the panel has finished entering from its tab's side.
  await page.getByRole('tabpanel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const row = page.locator('.tm-lists tbody tr').first();
  const start = await row.evaluate(
    el => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft)
  );
  const name = await row.locator('.tm-name').evaluate(el => el.getBoundingClientRect().left);
  expect(name).toBe(start);
  const actions = await row.locator('.tm-row-actions').evaluate(el => el.getBoundingClientRect().left);
  expect(actions).toBeLessThan(start);
});

test('a paper list reads as not received until staff tick List received, with no check result', async ({ page }) => {
  const tournament = runCommands(emptyTournament({ name: 'Friday League' }), ...adds);
  const id = tournament.players.find(player => player.firstName === 'Player1')?.id ?? '';
  let received = false;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      const manage = manageOf(CODE, tournament, {
        settings: { ...DEFAULT_SETTINGS, sanctioned: false, decklists: 'open', deckVisibility: 'always' },
        checkins: { [id]: received ? { paper: true, list: true } : { paper: true } }
      });
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { decklists: [list('Rogue', 'paper')], mine: null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  const row = page.locator('.tm-lists tbody tr').first();
  for (const [state, text] of [
    [false, 'Not received'],
    [true, 'Handed in on paper.']
  ] as const) {
    received = state;
    await page.goto(`/host/${CODE}`);
    await page.getByRole('tab', { name: 'Decklists' }).click();
    await expect(row.locator('.tm-list-check')).toHaveText(text);
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page.locator('.tm-expansion')).toHaveText(state ? 'Handed in on paper.' : 'Not received');
  }
});

test('a site registrant’s paper list reads as received once ticked, before they are on the roster', async ({
  page
}) => {
  const manage = manageOf(CODE, emptyTournament({ name: 'Friday League' }), {
    settings: { ...DEFAULT_SETTINGS, sanctioned: true, decklists: 'open', deckVisibility: 'always' },
    checkins: { '1234567': { list: true } }
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: organizerMe() });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decklists`) {
      return route.fulfill({ json: { decklists: [{ ...list('Rogue', 'paper'), popId: '1234567' }], mine: null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  await page.getByRole('tab', { name: 'Decklists' }).click();
  await expect(page.locator('.tm-lists tbody tr').first().locator('.tm-list-check')).toHaveText('Handed in on paper.');
});
