/**
 * Penalty notes in the console's Penalties tab, against mocked functions that
 * keep the record as the real ones do: append-only, an edit or removal a new
 * entry replacing the one before. The tab waits for round 1; then it records,
 * edits and removes notes, says a deciding penalty is a note only, and reads
 * deck checks in among the notes when asked.
 */

import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { test } from './network-guard';
import { deferred } from '../__utils__/deferred';

import type { Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import type { DeckCheckEntry } from '../../shared/tournament/deckChecks';
import type { PenaltyNoteEntry } from '../../shared/tournament/penaltyNotes';
import type { Tournament } from '../../shared/tournament/types';
import { DEFAULT_SETTINGS } from '../../shared/tournament/view';
import { organizerMe, runCommands } from './console-fixture';

const CODE = 'PEN001';

/**
 * Picks a player in the form's typeahead by first name, as listed: "Test, Ada".
 * Tried again if the list closes under the click: the box closes a moment
 * after it loses focus, and a test refocuses it faster than anyone could.
 */
async function pickPlayer(form: Locator, firstName: string) {
  await expect(async () => {
    await form.getByLabel('Player').fill(firstName);
    await form.getByRole('option', { name: new RegExp(`^Test, ${firstName}`) }).click({ timeout: 1000 });
  }).toPass();
}

const adds: Command[] = ['Ada', 'Ben', 'Cy', 'Di'].map(firstName => ({
  type: 'addPlayer',
  player: { firstName, lastName: 'Test' }
}));

const JUDGES = [
  { id: 'u1', name: 'Organizer' },
  { id: 'u2', name: 'Dana Kim' }
];

type Body = Record<string, unknown>;

/** A check Dana Kim recorded, for the log to read in among the notes. */
const check = (playerId: string): DeckCheckEntry => ({
  id: 'c1',
  playerId,
  playerName: 'Ben Test',
  round: 1,
  checker: { id: 'u2', name: 'Dana Kim' },
  result: 'fail',
  notes: 'Three Iono on the list, four in the deck.',
  recordedBy: 'Dana Kim',
  recordedAt: Date.now(),
  replaces: null,
  removed: false
});

function noteFrom(body: Body, playerName: string): Omit<PenaltyNoteEntry, 'id' | 'recordedBy' | 'recordedAt'> {
  const judge = JUDGES.find(j => j.id === body.judgeId);
  return {
    playerId: body.playerId as string,
    playerName,
    round: body.round as number,
    judge: judge ?? { id: null, name: body.judgeName as string },
    penalty: body.penalty as PenaltyNoteEntry['penalty'],
    notes: (body.notes as string) ?? '',
    replaces: (body.replaces as string | null) ?? null,
    removed: false
  };
}

function manageRoute(route: Route, tournament: Tournament, decklists: 'off' | 'closed', mode = 'swiss') {
  const url = new URL(route.request().url());
  if (url.searchParams.has('since')) {
    return route.fulfill({ status: 204 });
  }
  return route.fulfill({
    json: {
      code: CODE,
      mode,
      version: 3,
      updatedAt: 0,
      tournament,
      pending: [],
      reports: [],
      settings: { ...DEFAULT_SETTINGS, sanctioned: false, decklists },
      decks: {},
      role: 'owner',
      staffToken: 'invite',
      store: 'store-1'
    }
  });
}

function meRoute(route: Route) {
  return route.fulfill({ json: organizerMe() });
}

/**
 * The console's API, with a penalty note record kept as the functions keep it; every write is recorded,
 * and answered once `held` settles.
 */
async function mockConsole(
  page: Page,
  tournament: Tournament,
  decklists: 'off' | 'closed' = 'off',
  held: Promise<void> = Promise.resolve()
) {
  const entries: PenaltyNoteEntry[] = [];
  const writes: { method: string; body: Body | null; id: string | null }[] = [];
  const nameOf = (id: string) => {
    const player = tournament.players.find(p => p.id === id);
    return player ? `${player.firstName} ${player.lastName}` : '';
  };
  const append = (entry: Omit<PenaltyNoteEntry, 'id' | 'recordedBy' | 'recordedAt'>) =>
    entries.push({ ...entry, id: `n${entries.length + 1}`, recordedBy: 'Organizer', recordedAt: Date.now() });
  async function notesRoute(route: Route) {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Body;
      writes.push({ method: 'POST', body, id: null });
      append(noteFrom(body, nameOf(body.playerId as string)));
    }
    if (request.method() === 'DELETE') {
      const id = new URL(request.url()).searchParams.get('id');
      writes.push({ method: 'DELETE', body: null, id });
      const target = entries.find(entry => entry.id === id);
      if (target) {
        append({ ...target, replaces: target.id, removed: true });
      }
    }
    if (request.method() !== 'GET') {
      await held;
    }
    return route.fulfill({ json: { entries, judges: JUDGES } });
  }
  const ben = tournament.players.find(p => p.firstName === 'Ben')?.id ?? '';
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const routes: Record<string, () => Promise<void>> = {
      '/api/me': () => meRoute(route),
      [`/api/tournaments/${CODE}/manage`]: () => manageRoute(route, tournament, decklists),
      [`/api/tournaments/${CODE}/penalty-notes`]: () => notesRoute(route),
      [`/api/tournaments/${CODE}/deck-checks`]: () =>
        route.fulfill({ json: { entries: [check(ben)], checkers: JUDGES } })
    };
    return (routes[pathname] ?? (() => route.fulfill({ status: 404, json: { error: 'Not found' } })))();
  });
  await page.goto(`/host/${CODE}?tab=penalties`);
  return writes;
}

test('the Penalties tab waits for round 1 to be paired', async ({ page }) => {
  await mockConsole(page, runCommands(emptyTournament({ name: 'Friday League' }), ...adds));
  await expect(page.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Penalties' })).toHaveAttribute('aria-disabled', 'true');
});

test('a Disqualification note offers the disqualification itself, asked first', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const ada = t.players.find(player => player.firstName === 'Ada')?.id ?? '';
  await mockConsole(page, t);
  const commands: unknown[] = [];
  await page.route(`**/api/tournaments/${CODE}/commands`, route => {
    commands.push(route.request().postDataJSON());
    return manageRoute(route, runCommands(t, { type: 'disqualifyPlayer', id: ada }), 'off');
  });
  const form = page.locator('.tm-penalty-form');
  await pickPlayer(form, 'Ada');
  await form.getByLabel('Penalty').selectOption({ label: 'Disqualification' });
  await form.getByRole('button', { name: 'Save note' }).click();
  const offer = page.getByRole('status').filter({ hasText: 'Disqualification noted for Ada Test.' });
  await offer.getByRole('button', { name: 'Disqualify Ada Test' }).click();
  expect(commands).toEqual([]);
  await offer.getByRole('group', { name: 'Disqualify Ada Test?' }).getByRole('button', { name: 'Disqualify' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ command: { type: 'disqualifyPlayer', id: ada } });
  await expect(offer).toHaveCount(0);
});

test('a Disqualification note at a TOM event offers nothing the server would refuse', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const writes = await mockConsole(page, t);
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => manageRoute(route, t, 'off', 'tom'));
  await page.reload();
  const form = page.locator('.tm-penalty-form');
  await pickPlayer(form, 'Ada');
  await form.getByLabel('Penalty').selectOption({ label: 'Disqualification' });
  await form.getByRole('button', { name: 'Save note' }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByText('Disqualification noted for Ada Test.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disqualify Ada Test' })).toHaveCount(0);
});

test('a penalty note is recorded, edited and removed, and changes nothing else', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const ada = t.players.find(player => player.firstName === 'Ada')?.id;
  const writes = await mockConsole(page, t);
  const form = page.locator('.tm-penalty-form');
  await expect(page.getByText('No penalty notes yet.')).toBeVisible();
  await expect(form.getByLabel('Round')).toHaveValue('1');
  await expect(form.getByLabel('Judge')).toHaveValue('u1');

  await form.getByRole('button', { name: 'Save note' }).click();
  await expect(form.getByRole('alert')).toHaveText('Choose a player');
  await pickPlayer(form, 'Ada');
  await form.getByLabel('Penalty').selectOption({ label: 'Game Loss' });
  await expect(form).toContainText('A note only.');
  await form.getByLabel('Notes').fill('Drew two extra cards.');
  await form.getByRole('button', { name: 'Save note' }).click();

  const log = page.locator('.tm-penalty-log');
  await expect(log.locator('tbody tr')).toHaveCount(1);
  await expect(log).toContainText('Ada Test');
  await expect(log).toContainText('Game Loss');
  await expect(form.getByLabel('Player')).toHaveValue('');
  expect(writes[0]?.body).toEqual({
    playerId: ada,
    round: 1,
    penalty: 'game-loss',
    notes: 'Drew two extra cards.',
    replaces: null,
    judgeId: 'u1'
  });

  await log.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText('Edit note')).toBeVisible();
  await form.getByLabel('Penalty').selectOption({ label: 'Warning' });
  await form.getByLabel('Judge').selectOption({ label: 'Someone else' });
  await form.getByLabel('Name').fill('Head Judge Sam');
  await form.getByRole('button', { name: 'Save edit' }).click();
  await expect(log).toContainText('Warning');
  await expect(log).toContainText('Head Judge Sam');
  expect(writes[1]?.body).toMatchObject({ replaces: 'n1', penalty: 'warning', judgeName: 'Head Judge Sam' });
  await log.getByRole('button', { name: 'Show 1 earlier version' }).click();
  await expect(log.locator('.tm-check-earlier')).toContainText('Game Loss · Organizer');

  await log.getByRole('button', { name: 'Remove' }).click();
  await log.getByRole('group', { name: 'Remove this penalty note?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No penalty notes yet.')).toBeVisible();
  expect(writes[2]).toMatchObject({ method: 'DELETE', id: 'n2' });
  expect(writes.every(write => write.method !== 'PUT')).toBe(true);
});

test('a note saved while the next is typed keeps the next, as does removing a note it does not edit', async ({
  page
}) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const answer = deferred<void>();
  await mockConsole(page, t, 'off', answer.promise);
  const form = page.locator('.tm-penalty-form');
  const log = page.locator('.tm-penalty-log');
  await pickPlayer(form, 'Ada');
  await form.getByLabel('Penalty').selectOption({ label: 'Game Loss' });
  await form.getByRole('button', { name: 'Save note' }).click();
  await expect(form.getByRole('button', { name: 'Save note' })).toBeDisabled();
  await pickPlayer(form, 'Ben');
  await form.getByLabel('Notes').fill('Slow play, second time.');
  answer.resolve();
  await expect(log.locator('tbody tr')).toHaveCount(1);
  await expect(log).toContainText('Ada Test');
  await expect(form.getByLabel('Player')).toHaveValue('Test, Ben');
  await expect(form.getByLabel('Notes')).toHaveValue('Slow play, second time.');

  await log.getByRole('button', { name: 'Remove' }).click();
  await log.getByRole('group', { name: 'Remove this penalty note?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No penalty notes yet.')).toBeVisible();
  await expect(form.getByLabel('Player')).toHaveValue('Test, Ben');
  await expect(form.getByLabel('Notes')).toHaveValue('Slow play, second time.');

  await form.getByLabel('Penalty').selectOption({ label: 'Caution' });
  await form.getByRole('button', { name: 'Save note' }).click();
  await expect(form.getByLabel('Player')).toHaveValue('');
  await log.getByRole('button', { name: 'Edit' }).click();
  await expect(form.getByLabel('Player')).toHaveValue('Test, Ben');
  await log.getByRole('button', { name: 'Remove' }).click();
  await log.getByRole('group', { name: 'Remove this penalty note?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Record a penalty')).toBeVisible();
  await expect(form.getByLabel('Player')).toHaveValue('');
});

test('the player is found by the table they sit at, and listed by last name', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const table = t.pods[0]!.rounds[0]!.matches.find(match => match.p2 !== null)!;
  const names = new Map(t.players.map(player => [player.id, `Test, ${player.firstName}`]));
  await mockConsole(page, t);
  const form = page.locator('.tm-penalty-form');
  await form.getByLabel('Player').fill(String(table.table));
  // The table's players lead, by last name then first; any Player ID that starts with the number follows them.
  const seated = [names.get(table.p1)!, names.get(table.p2!)!].sort();
  await expect(form.getByRole('option').nth(0)).toHaveText(`${seated[0]}Table ${table.table}`);
  await expect(form.getByRole('option').nth(1)).toHaveText(`${seated[1]}Table ${table.table}`);
  await form.getByRole('option').first().click();
  await expect(form.getByLabel('Player')).toHaveValue(seated[0]!);
});

test('deck checks read in among the notes when the event takes decklists', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  await mockConsole(page, t, 'closed');
  const form = page.locator('.tm-penalty-form');
  await pickPlayer(form, 'Ben');
  await form.getByLabel('Penalty').selectOption({ label: 'Caution' });
  await form.getByRole('button', { name: 'Save note' }).click();
  const log = page.locator('.tm-penalty-log');
  await expect(log.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('radio', { name: 'With deck checks' }).click();
  await expect(log.locator('tbody tr')).toHaveCount(2);
  await expect(log).toContainText('Deck check Fail');
  await page.getByLabel('Search penalty notes').fill('iono');
  await expect(log.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Search penalty notes').fill('zzz');
  await expect(page.getByText('No notes match.')).toBeVisible();
});

test('a row a search or round keeps is the same row, still open as it was', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  await mockConsole(page, t);
  const form = page.locator('.tm-penalty-form');
  const log = page.locator('.tm-penalty-log');
  for (const [player, penalty] of [
    ['Ada', 'Game Loss'],
    ['Ben', 'Caution']
  ] as const) {
    await pickPlayer(form, player);
    await form.getByLabel('Penalty').selectOption({ label: penalty });
    await form.getByRole('button', { name: 'Save note' }).click();
    await expect(form.getByLabel('Player')).toHaveValue('');
  }
  const ada = log.locator('tbody tr', { hasText: 'Ada Test' });
  await ada.getByRole('button', { name: 'Edit' }).click();
  await form.getByLabel('Penalty').selectOption({ label: 'Warning' });
  await form.getByRole('button', { name: 'Save edit' }).click();
  await ada.getByRole('button', { name: 'Show 1 earlier version' }).click();
  await ada.getByRole('button', { name: 'Remove' }).click();
  const row = await ada.elementHandle();

  await page.getByLabel('Search penalty notes').fill('ad');
  await page.getByLabel('Search penalty notes').fill('ada');
  await page.locator('.tm-box-bar select[aria-label="Round"]').selectOption('1');
  await expect(log.locator('tbody tr')).toHaveCount(1);
  expect(await row?.evaluate(element => element.isConnected)).toBe(true);
  await expect(ada.locator('.tm-check-earlier')).toContainText('Game Loss');
  await expect(ada.getByRole('group', { name: 'Remove this penalty note?' })).toBeVisible();
});

test('deck checks that could not be read say so beside the notes, with a retry', async ({ page }) => {
  const t = runCommands(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const ben = t.players.find(player => player.firstName === 'Ben')?.id ?? '';
  await mockConsole(page, t, 'closed');
  let reads = 0;
  await page.route(`**/api/tournaments/${CODE}/deck-checks`, route => {
    reads += 1;
    return reads === 1
      ? route.fulfill({ status: 503, json: { error: 'Try again shortly' } })
      : route.fulfill({ json: { entries: [check(ben)], checkers: JUDGES } });
  });
  const form = page.locator('.tm-penalty-form');
  await pickPlayer(form, 'Ada');
  await form.getByLabel('Penalty').selectOption({ label: 'Caution' });
  await form.getByRole('button', { name: 'Save note' }).click();
  const log = page.locator('.tm-penalty-log');
  await expect(log.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('radio', { name: 'With deck checks' }).click();
  await expect(page.getByText('Deck checks could not be loaded.')).toBeVisible();
  await expect(log.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(log.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText('Deck checks could not be loaded.')).toHaveCount(0);
});
