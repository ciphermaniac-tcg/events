/**
 * The tournament pages against mocked functions: the public page shows the
 * current round's tables and a searchable field, opens a player's history,
 * ranks a combined pod per division, and never asks a signed-out player to
 * do more than sign in. The data is the hand-written mid-event .tdf fixture,
 * run through the same public-view code the function uses.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { deferred } from '../__utils__/deferred';
import { chunkOf } from './build-manifest';

import { applyCommand } from '../../shared/tournament/commands';
import { birthYear } from '../../shared/tournament/divisions';
import { seededRandom } from '../../shared/tournament/random';
import { parseTdf } from '../../shared/tournament/tdf';
import {
  applyPending,
  assignKeys,
  DEFAULT_SETTINGS,
  isSanctioned,
  publicDecks,
  publicDivisions,
  publicTournament,
  type TournamentView
} from '../../shared/tournament/view';

const CODE = 'ABCDEF';
const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const keys = assignKeys(tdf, {});
/** The birth year a player says beside their Player ID. */
const yearOf = (lastName: string) => String(birthYear(tdf.players.find(p => p.lastName === lastName)?.birthDate ?? ''));
const VIEW: TournamentView = {
  code: CODE,
  mode: 'tom',
  version: 4,
  updatedAt: 0,
  tournament: publicTournament(tdf, keys),
  pending: [],
  reports: [],
  divisions: publicDivisions(tdf, keys, Date.UTC(2026, 9, 3)),
  decks: publicDecks({ '7200001': 'Gardevoir ex' }, keys),
  settings: { ...DEFAULT_SETTINGS, details: 'Doors at 11', deckVisibility: 'always' },
  viewer: { role: null, me: null, via: null, signedIn: false }
};

async function mockApi(page: Page, view: TournamentView = VIEW) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: ['google', 'discord'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/report`) {
      const claim = route.request().postDataJSON() as { popId?: string; lastName?: string };
      const player = tdf.players.find(p => p.id === claim.popId || p.lastName === claim.lastName);
      return player
        ? route.fulfill({ json: { key: keys[player.id], view } })
        : route.fulfill({ status: 404, json: { error: 'No player by that name is in this event' } });
    }
    if (url.pathname === `/api/tournaments/${CODE}`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return errors;
}

test('the public page shows the round, finds a player and opens their history @mobile', async ({ page }) => {
  const errors = await mockApi(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
  await expect(page.locator('.tm-details')).toHaveText('Doors at 11');
  const rows = page.locator('.tm-matches tbody tr');
  await expect(rows).toHaveCount(4);
  if (test.info().project.name === 'mobile') {
    // A phone has no search: the round and its tables are the list.
    await expect(page.getByRole('searchbox', { name: 'Find a player' })).toBeHidden();
  } else {
    await page.getByRole('searchbox', { name: 'Find a player' }).fill('lamarr');
    await expect(rows).toHaveCount(1);
  }
  await page
    .getByRole('button', { name: /Hedy Lamarr/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Hedy Lamarr');
  await expect(sheet.locator('.tm-history tbody tr')).toHaveCount(2);
  await sheet.getByRole('button', { name: 'This is me' }).click();
  // Saying so takes proof: the Player ID and birth year at a sanctioned event, the last name at any other.
  const hedy = tdf.players.find(p => p.lastName === 'Lamarr');
  const [label, right, wrong] = isSanctioned(VIEW)
    ? ['Player ID', hedy?.id ?? '', '7200001']
    : ['Last name', 'Lamarr', 'Jackson'];
  if (isSanctioned(VIEW)) {
    await sheet.getByLabel('Birth year').fill(yearOf('Lamarr'));
  }
  await sheet.getByLabel(label).fill(wrong);
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.locator('.tm-error')).toContainText('isn’t this player’s');
  await sheet.getByLabel(label).fill(right);
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.getByRole('button', { name: 'This isn’t me' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tm-you-big')).toHaveText(/Table\s*2/);
  await expect(page.locator('.tm-you-who')).toContainText('Hedy Lamarr');
  expect(errors).toEqual([]);
});

test('retrying a lost identify response restores reporting and remembers the recovered token', async ({ page }) => {
  const view = { ...VIEW, settings: { ...VIEW.settings, playerReporting: true } };
  await mockApi(page, view);
  await publish(page, () => view);
  const mary = tdf.players.find(player => player.lastName === 'Jackson');
  const requests: { device: string; reportToken?: string; result?: string }[] = [];
  await page.route(`**/api/tournaments/${CODE}/report`, route => {
    const body = route.request().postDataJSON() as (typeof requests)[number];
    requests.push(body);
    if (requests.length === 1) {
      return route.abort('connectionreset');
    }
    return route.fulfill({ json: { key: keys[mary?.id ?? ''], view, reporter: true, reportToken: body.device } });
  });
  await page.goto(`/t/${CODE}`);
  await page.getByLabel('Player ID', { exact: true }).fill(mary?.id ?? '');
  await page.getByLabel('Birth year').fill(yearOf('Jackson'));
  await page.getByRole('button', { name: 'Find my match' }).click();
  await expect(page.locator('.tm-you-ask .tm-error')).toBeVisible();
  await page.getByRole('button', { name: 'Find my match' }).click();
  await expect(page.getByRole('button', { name: 'Report result' })).toBeVisible();
  expect(requests[1]?.device).toBe(requests[0]?.device);
  await page.reload();
  await page.getByRole('button', { name: 'Report result' }).click();
  await page.getByRole('button', { name: 'I won', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.result).toBe('win');
  expect(requests.at(-1)?.reportToken).toBe(requests[0]?.device);
});

test('a signed-in player whose account just became the player asks once who the page says they are', async ({
  page
}) => {
  const hedy = tdf.players.find(p => p.lastName === 'Lamarr');
  const key = keys[hedy?.id ?? ''] ?? null;
  let linked = false;
  let wholeViews = 0;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: { id: 'hedy', name: 'Hedy' }, providers: [] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/report`) {
      linked = true;
      const { viewer: _viewer, ...published } = VIEW;
      return route.fulfill({ json: { key, view: published, reporter: true, linked: true } });
    }
    if (url.pathname === `/api/tournaments/${CODE}` && !url.searchParams.has('since')) {
      wholeViews += 1;
      const viewer = { role: null, me: linked ? key : null, via: linked ? 'pop' : null, signedIn: true } as const;
      return route.fulfill({ json: { ...VIEW, viewer } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
  expect(wholeViews).toBe(1);
  await page
    .locator('.tm-matches')
    .getByRole('button', { name: /Hedy Lamarr/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'This is me' }).click();
  await sheet.getByLabel('Player ID').fill(hedy?.id ?? '');
  await sheet.getByLabel('Birth year').fill(yearOf('Lamarr'));
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.getByRole('button', { name: 'This isn’t me' })).toBeVisible();
  await expect.poll(() => wholeViews).toBe(2);
});

/** The event's published file on the data origin: what the page reads first, and then polls. */
async function publish(page: Page, current: () => TournamentView) {
  await page.route(`**/tournaments/v1/${CODE}.json`, route => {
    const { viewer: _viewer, ...published } = current();
    return route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } });
  });
}

/** The fixture with its first open table of round 2 won by player one, as the next version. */
function afterOneResult(): TournamentView {
  const next = structuredClone(VIEW);
  const open = next.tournament.pods[0]?.rounds.at(-1)?.matches.find(match => match.outcome === 'pending');
  if (!open) {
    throw new Error('the fixture has no open table');
  }
  open.outcome = 'p1';
  return { ...next, version: VIEW.version + 1 };
}

/** Word from the console in another tab that the event moved on, as lib/tournament/changes.ts sends it. */
const announce = (page: Page, version: number) =>
  page.evaluate(change => new BroadcastChannel('cm-tournament-changes').postMessage(change), { code: CODE, version });

test('a player opening the page reads the published file, and asks the functions for no event', async ({ page }) => {
  await mockApi(page);
  await publish(page, () => VIEW);
  const asked: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === `/api/tournaments/${CODE}`) {
      asked.push(request.url());
    }
  });
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
  expect(asked).toEqual([]);
});

test('a result coming in redraws its own table, and leaves the search and the other tables as they were', async ({
  page
}) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}`);
  const rows = page.locator('.tm-matches tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'In progress' })).toHaveCount(2);
  const search = page.getByRole('searchbox', { name: 'Find a player' });
  await search.focus();
  // Marked, so a row or a search box drawn again from nothing shows as one that lost its mark.
  await page.locator('.tm-matches tbody tr, .tm-public-pairings input').evaluateAll(els => {
    els.forEach(el => el.setAttribute('data-kept', ''));
  });
  view = afterOneResult();
  await announce(page, view.version);
  await expect(rows.filter({ hasText: 'In progress' })).toHaveCount(1);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('data-kept', '');
  await expect(page.locator('.tm-matches tbody tr[data-kept]')).toHaveCount(3);
});

test('a result coming in re-ranks the standings in place', async ({ page }) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}?tab=standings`);
  const rows = page.locator('.tm-standings tbody tr');
  await expect(rows).toHaveCount(8);
  const search = page.getByRole('searchbox', { name: 'Find a player' });
  await search.focus();
  await page.locator('.tm-standings tbody tr, .tm-standings-bar input').evaluateAll(els => {
    els.forEach(el => el.setAttribute('data-kept', ''));
  });
  const before = await rows.allInnerTexts();
  view = afterOneResult();
  await announce(page, view.version);
  await expect.poll(() => rows.allInnerTexts()).not.toEqual(before);
  await expect(search).toBeFocused();
  await expect(page.locator('.tm-standings tbody tr[data-kept]')).toHaveCount(8);
});

test('a result coming in leaves the big screen’s other tables where they were', async ({ page }) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}?screen=1`);
  const tables = page.locator('.tm-screen-tables li');
  await expect(tables).toHaveCount(4);
  await expect(page.locator('.tm-screen-tables li.is-done')).toHaveCount(1);
  await page.locator('.tm-screen-pod, .tm-screen-tables li').evaluateAll(els => {
    els.forEach(el => el.setAttribute('data-kept', ''));
  });
  view = afterOneResult();
  await announce(page, view.version);
  await expect(page.locator('.tm-screen-tables li.is-done')).toHaveCount(2);
  await expect(page.locator('.tm-screen-pod[data-kept]')).toHaveCount(1);
  await expect(page.locator('.tm-screen-tables li[data-kept]')).toHaveCount(3);
});

test('standings rank a combined pod per division', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?tab=standings`);
  await expect(page.locator('.tm-subhead')).toHaveText(['Juniors', 'Masters']);
  await expect(page.locator('.tm-standings').last().locator('tbody tr')).toHaveCount(7);
});

test('signing in from an event page comes back to that event', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?tab=standings`);
  await page.locator('.site-head').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/settings\\?next=%2Ft%2F${CODE}%3Ftab%3Dstandings$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await expect(page).toHaveTitle('Sign in — Ciphermaniac Events');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
    'href',
    `/api/auth/login/google?next=${encodeURIComponent(`/t/${CODE}?tab=standings`)}`
  );
});

test('the old /host address opens the home page at the root, query and all', async ({ page }) => {
  await mockApi(page);
  await page.goto('/host?tab=organizing');
  await expect(page).toHaveURL(/:\d+\/\?tab=organizing$/);
  await expect(page.getByRole('link', { name: 'Ciphermaniac Events' })).toBeVisible();
});

test('a signed-out organizer is offered sign-in, not a console @mobile', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  // The site's own head, and none of the main site's nav.
  await expect(page.getByRole('link', { name: 'Ciphermaniac Events' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Cards', exact: true })).toHaveCount(0);
  // The sample event plays on the real engine, its standings cut to the top eight.
  const sample = page.getByRole('region', { name: 'Sample event' });
  await expect(sample.locator('.tm-sim-stand .sr-only li')).toHaveCount(8);
  await expect(sample.getByText('Round 1', { exact: true })).toBeVisible();
  // The head's Sign in jumps to the hero's sign-in, every time it is pressed.
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/#sign-in$/);
  // The home page offers sign-in at the top and again at the end.
  const google = page.getByRole('link', { name: 'Sign in with Google' }).first();
  await expect(google).toHaveAttribute('href', '/api/auth/login/google?next=%2F');
  await expect(page.getByRole('link', { name: 'Sign in with Discord' }).first()).toBeVisible();
  // The server has to see the click: the client router must not take it as one of its own routes.
  const login = page.waitForRequest(
    request => request.isNavigationRequest() && new URL(request.url()).pathname === '/api/auth/login/google'
  );
  await google.click();
  await login;
});

async function mockOrganizer(page: Page) {
  const submissions: unknown[] = [];
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/me') {
      return route.fulfill({
        json: {
          user: {
            id: 'organizer',
            name: 'Organizer',
            role: null,
            stores: [
              {
                id: 'store-1',
                name: 'Test Games',
                leagueId: '1000001',
                status: 'active',
                timeZone: 'America/Chicago',
                role: 'manager'
              }
            ]
          },
          providers: []
        }
      });
    }
    if (pathname === '/api/tournaments' && route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { error: 'Fixture submission' } });
    }
    return route.fulfill({ json: { tournaments: [] } });
  });
  return submissions;
}

test('sanctioned setup requires Play! Tools confirmation; local setup skips it @mobile', async ({ page }) => {
  const submissions = await mockOrganizer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const create = page.getByRole('button', { name: 'Create event' });
  const confirmation = page.getByRole('checkbox', { name: 'I’ve created this event in Play! Tools' });
  await expect(create).toBeDisabled();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Tuesday League');
  await expect(create).toBeEnabled();
  await expect(confirmation).toHaveCount(0);
  const sanctioned = page.getByRole('radiogroup', { name: 'Sanctioned', exact: true });
  await sanctioned.getByRole('radio', { name: 'Yes', exact: true }).click();
  await expect(confirmation).not.toBeChecked();
  await expect(create).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Play! Tools', exact: true })).toHaveAttribute(
    'href',
    'https://play-tools.pokemon.com/'
  );
  await expect(page.getByRole('link', { name: 'Sanctioning guide' })).toHaveAttribute(
    'href',
    'https://play-tools.pokemon.com/guide'
  );
  // A programmatic submit must obey the same gate as the disabled button.
  await page.locator('.tm-setup').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true })));
  expect(submissions).toEqual([]);
  await confirmation.check();
  await expect(create).toBeEnabled();
  await confirmation.uncheck();
  await expect(create).toBeDisabled();
  await sanctioned.getByRole('radio', { name: 'No', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(create).toBeEnabled();
  await sanctioned.getByRole('radio', { name: 'Yes', exact: true }).click();
  await confirmation.check();
  await create.click();
  await expect(page.locator('.tm-error')).toHaveText('Fixture submission');
  expect(submissions).toEqual([
    expect.objectContaining({ name: 'Tuesday League', settings: expect.objectContaining({ sanctioned: true }) })
  ]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(confirmation).toBeChecked();
});

for (const [eventType, label] of [
  ['local', 'Local'],
  ['prerelease', 'Prerelease']
] as const) {
  test(`${label} setup sends the selected kind @mobile`, async ({ page }) => {
    const submissions = await mockOrganizer(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Start an event' }).click();
    await page.getByRole('textbox', { name: 'Event name' }).fill('Synthetic');
    const kinds = page.getByRole('radiogroup', { name: 'Event type', exact: true });
    await kinds.getByRole('radio', { name: label, exact: true }).click();
    await expect(page.locator('#setup-minutes')).toHaveAttribute('min', eventType === 'local' ? '10' : '20');
    await expect(page.locator('#setup-minutes')).toHaveAttribute('max', '90');
    await page.locator('#setup-minutes').fill(eventType === 'local' ? '10' : '20');
    await expect(kinds.getByRole('radio', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.locator('.tm-error')).toHaveText('Fixture submission');
    expect(submissions).toEqual([expect.objectContaining({ eventType, name: 'Synthetic' })]);
  });
}

test('a TOM sanction ID shows an unchecked confirmation; an unsanctioned file skips it', async ({ page }) => {
  await mockOrganizer(page);
  // Use the upload fallback, so the test supplies a file without an OS picker.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
  await page.goto('/');
  const buffer = readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url));
  await page.locator('input[type="file"]').setInputFiles({ name: 'challenge.tdf', mimeType: 'text/xml', buffer });
  const confirmation = page.getByRole('checkbox', { name: 'I’ve created this event in Play! Tools' });
  const create = page.getByRole('button', { name: 'Create event' });
  await expect(confirmation).not.toBeChecked();
  await expect(create).toBeDisabled();
  await confirmation.check();
  await expect(create).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'local.tdf',
    mimeType: 'text/xml',
    buffer: Buffer.from(buffer.toString().replace('<id>26-09-000456</id>', '<id></id>'))
  });
  await expect(confirmation).toHaveCount(0);
  await expect(create).toBeEnabled();
});

test('the big screen hides the site chrome and shows a QR code to the event', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?screen=1`);
  // One row per table in order, then the bye: round 2 seats seven players at three tables.
  const rows = page.locator('.tm-screen-tables li');
  await expect(rows).toHaveCount(4);
  await expect(rows.first().locator('.tm-screen-table')).toHaveText('1');
  await expect(page.locator('.topnav')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Event page QR code' })).toBeVisible();
});

test('the big screen remembers its scroll speed, cycled with S', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.getByRole('radio', { name: 'Slow' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('s');
  await expect(page.getByRole('radio', { name: 'Moderate' })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Moderate' })).toHaveAttribute('aria-checked', 'true');
});

test('before round 1 the big screen lists everyone registered by first name, beside the QR code', async ({ page }) => {
  const unpaired = { ...VIEW.tournament, pods: VIEW.tournament.pods.map(pod => ({ ...pod, rounds: [] })) };
  await mockApi(page, { ...VIEW, tournament: unpaired });
  await page.goto(`/t/${CODE}?screen=1`);
  const players = VIEW.tournament.players
    .filter(p => p.droppedAfter === null)
    .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
  await expect(page.locator('.tm-screen-registered li')).toHaveCount(players.length);
  // The list scrolls itself, and a keyboard can reach it to scroll it too.
  await expect(page.getByRole('region', { name: 'Players' })).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.tm-screen-registered li').first()).toHaveText(
    `${players[0]?.firstName} ${players[0]?.lastName}`
  );
  await expect(page.locator('.tm-screen-status')).toHaveText(`Registration · ${players.length} players`);
  await expect(page.locator('.tm-screen-join.is-large').getByRole('img', { name: 'Event page QR code' })).toBeVisible();
});

test('once the event ends the big screen shows the standings', async ({ page }) => {
  await mockApi(page, { ...VIEW, settings: { ...VIEW.settings, finished: true } });
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.tm-screen-tables')).toHaveCount(0);
  const first = page.locator('.tm-screen-standings tbody tr').first();
  await expect(first.locator('.tm-screen-place')).toHaveText('1');
  await expect(page.locator('.tm-screen-deck-name')).toHaveText('Gardevoir ex');
  const place = await first.locator('.tm-screen-place').boundingBox();
  const name = await first.locator('.tm-screen-player').boundingBox();
  expect((name?.x ?? 0) - ((place?.x ?? 0) + (place?.width ?? 0))).toBeGreaterThanOrEqual(0);
});

test('before round 1 the public page lists everyone registered @mobile', async ({ page }) => {
  const unpaired = { ...VIEW.tournament, pods: VIEW.tournament.pods.map(pod => ({ ...pod, rounds: [] })) };
  await mockApi(page, { ...VIEW, tournament: unpaired });
  await page.goto(`/t/${CODE}`);
  const players = VIEW.tournament.players.filter(p => p.droppedAfter === null);
  await expect(page.locator('.tm-status')).toHaveText(`Registration · ${players.length} players`);
  await expect(page.locator('.tm-registered li')).toHaveCount(players.length);
});

test('the player sheet keeps Tab inside it until it closes', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  await page.locator('.tm-matches tbody tr').first().getByRole('button').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
});

test('a result coming in leaves a reader scrolled down the page where they were', async ({ page }) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}`);
  const rows = page.locator('.tm-matches tbody tr');
  await expect(rows.filter({ hasText: 'In progress' })).toHaveCount(2);
  // Room to scroll past the tabs, as a field of hundreds gives.
  const at = await page.evaluate(() => {
    document.body.style.paddingBottom = '4000px';
    window.scrollTo(0, document.documentElement.scrollHeight);
    return window.scrollY;
  });
  const tabs = page.getByRole('tablist', { name: 'Event sections' });
  await expect(tabs).not.toBeInViewport();
  view = afterOneResult();
  await announce(page, view.version);
  await expect(rows.filter({ hasText: 'In progress' })).toHaveCount(1);
  // A smooth scroll would have started within a few frames of the redraw.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(at);
});

test('tabs clipped by a narrow strip bring the one picked into view along it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  // Narrower than its tabs, as a phone's strip is once an event has every tab.
  await page.addStyleTag({ content: '.tabs { max-width: 140px; }' });
  const all = page.getByRole('tablist', { name: 'Event sections' }).getByRole('tab');
  const last = all.last();
  await expect(last).not.toBeInViewport({ ratio: 1 });
  await all.first().focus();
  await page.keyboard.press('End');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a first load that fails offers Try again, which loads the event', async ({ page }) => {
  await mockApi(page);
  let failing = true;
  await page.route(`**/api/tournaments/${CODE}`, route =>
    failing ? route.fulfill({ status: 500, json: { error: 'Something went wrong' } }) : route.fallback()
  );
  await page.goto(`/t/${CODE}`);
  const retry = page.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible();
  failing = false;
  await retry.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
});

const TDF_SOURCE = readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8');

/** A signed-in organizer's console for the TOM event, with a browser that can link files. */
/** The console's copy of the TOM event the file below holds. */
const tomManage = () => ({
  ...VIEW,
  lastImportAt: Date.parse('2026-10-14T12:00:00Z'),
  tournament: tdf,
  decks: {},
  settings: DEFAULT_SETTINGS,
  role: 'owner',
  staffToken: 'invite',
  store: 'store-1'
});

type Answer = { status: number; json: unknown };
type SyncAnswer = Answer | null;

/**
 * A console following a linked file; `sync` answers each sync, and null leaves
 * one hanging; `pairing` answers each ask for the next round.
 */
async function tomConsole(
  page: Page,
  sync: (body: string) => SyncAnswer | Promise<SyncAnswer>,
  {
    manage = tomManage(),
    pairing,
    following = true
  }: { manage?: unknown; pairing?: (body: unknown) => Answer; following?: boolean } = {}
) {
  await page.addInitScript(source => {
    const file = { modified: 1, lost: false, text: source };
    Object.assign(window, {
      tdfFile: file,
      showOpenFilePicker: async () => [
        {
          name: 'event.tdf',
          getFile: async () => {
            if (file.lost) {
              throw new DOMException('The file cannot be read', 'NotAllowedError');
            }
            return new File([file.text], 'event.tdf', { lastModified: file.modified });
          },
          createWritable: async () => ({
            write: async (text: string) => {
              file.text = text;
              file.modified += 1;
            },
            close: async () => undefined
          }),
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted'
        }
      ]
    });
  }, TDF_SOURCE);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
      const account = {
        ...user,
        birthDate: null,
        role: 'community',
        stores: [],
        handle: 'organizer',
        publicProfile: false,
        profileName: 'real',
        providers: ['dev']
      };
      return route.fulfill({ json: { user: account, providers: ['dev'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/sync`) {
      return Promise.resolve(sync(route.request().postData() ?? '')).then(answer =>
        answer ? route.fulfill(answer) : undefined
      );
    }
    if (url.pathname === `/api/tournaments/${CODE}/pairing` && pairing) {
      return route.fulfill(pairing(route.request().postDataJSON()));
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  if (!following) {
    await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
  }
  await page.goto(`/host/${CODE}`);
  if (following) {
    await page.getByRole('button', { name: 'Link .tdf file' }).click();
  }
}

const synced = () => ({ status: 200, json: { ...tomManage(), version: 5, revision: 'next' } });

test('a TOM console stops following its file when another copy was synced over it', async ({ page }) => {
  await tomConsole(page, () => ({ status: 409, json: { error: 'The site has a different copy of this event.' } }));
  await expect(page.getByText('The site has a different copy of this event.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect event.tdf' })).toBeVisible();
});

test('a TOM console sends nothing of its file while the event has ended', async ({ page }) => {
  let syncs = 0;
  await tomConsole(
    page,
    () => {
      syncs += 1;
      return synced();
    },
    {
      manage: { ...tomManage(), settings: { ...DEFAULT_SETTINGS, finished: true } }
    }
  );
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('Fixture Challenge', 'Saved After');
    file.modified = 2;
  });
  await page.getByRole('button', { name: 'Refresh .tdf' }).first().click();
  await page.waitForTimeout(500);
  expect(syncs).toBe(0);
});

test('a TOM console holds off results when the browser takes back the file', async ({ page }) => {
  await tomConsole(page, () => ({ status: 200, json: { ...tomManage(), version: 5, revision: 'next' } }));
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { tdfFile: { lost: boolean } }).tdfFile.lost = true;
  });
  await expect(page.getByRole('button', { name: 'Reconnect event.tdf' })).toBeVisible();
});

test('a TOM console gives up on a sync that hangs and sends the file again', async ({ page }) => {
  await page.clock.install();
  let syncs = 0;
  await tomConsole(page, () => (++syncs === 1 ? null : synced()));
  await expect.poll(() => syncs).toBe(1);
  await page.clock.fastForward(31_000);
  await expect(page.getByText('Could not send the .tdf: The site took too long to answer')).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page.getByText('The site took too long to answer')).toBeHidden();
  expect(syncs).toBeGreaterThan(1);
});

test('a TOM console reads the file again for a refresh pressed while a sync is under way', async ({ page }) => {
  const bodies: string[] = [];
  let release = () => undefined as void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await tomConsole(page, async body => {
    bodies.push(body);
    if (bodies.length === 2) {
      await held;
    }
    return synced();
  });
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('Fixture Challenge', 'Saved Once');
    file.modified = 2;
  });
  await expect.poll(() => bodies.length).toBe(2);
  // TOM saves again within the same modified time, which only a refresh picks up.
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string } }).tdfFile;
    file.text = file.text.replace('Saved Once', 'Saved Twice');
  });
  await page.getByRole('button', { name: 'Refresh .tdf' }).first().click();
  release();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toContain('Saved Twice');
});

test('a TOM console says when the file TOM saved does not parse', async ({ page }) => {
  await tomConsole(page, synced);
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('outcome="1"', 'outcome="7"');
    file.modified = 2;
  });
  await expect(page.getByText('Could not parse the .tdf: Unknown match outcome "7"')).toBeVisible();
});

test('a TOM console pairs the next round into the file once every result is in', async ({ page }) => {
  const pod = tdf.pods[0]!;
  const round = pod.rounds.at(-1)!;
  const pending = round.matches
    .filter(m => m.p2 !== null && m.outcome === 'pending')
    .map(m => ({
      pod: pod.category,
      round: round.number,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1' as const,
      at: 0
    }));
  const settled = () => ({ status: 200, json: { ...tomManage(), pending, version: 5, revision: 'next' } });
  const asked: unknown[] = [];
  // The site pairs over the results entered on it, as the pairing function does for a TOM event.
  const paired = applyCommand(
    applyPending(tdf, pending),
    { type: 'pairRound', pod: pod.category },
    { now: 0, localTime: '09/30/2026 13:00:00', season: 2027, random: seededRandom(7) }
  );
  const pairing = (body: unknown) => {
    asked.push(body);
    return paired.ok
      ? { status: 200, json: { tournament: paired.tournament } }
      : { status: 400, json: { error: paired.error } };
  };
  await tomConsole(page, settled, { manage: { ...tomManage(), pending }, pairing });
  await expect(page.getByRole('button', { name: 'Write 2 results to .tdf' })).toBeVisible();
  const sent = page.waitForRequest(
    request => request.url().endsWith('/sync') && request.postDataJSON().tournament.pods[0].rounds.length === 3
  );
  await page.getByRole('button', { name: 'Pair round 3' }).click();
  const ask = page.getByRole('group', { name: 'Pair into the .tdf' });
  await expect(ask).toContainText('Close the event in TOM before writing, then reopen the file in TOM.');
  await ask.getByRole('button', { name: 'Pair round 3' }).click();
  const followed = await sent;
  expect(asked).toEqual([expect.objectContaining({ pod: pod.category, base: 'next' })]);
  expect(followed.postDataJSON().base).toBe('next');
  const written = parseTdf(
    await page.evaluate(() => (window as unknown as { tdfFile: { text: string } }).tdfFile.text)
  );
  const [, second, third] = written.pods[0]!.rounds;
  expect(second?.matches.every(m => m.outcome !== 'pending')).toBe(true);
  expect(third?.number).toBe(3);
  expect(third?.matches.filter(m => m.p2 !== null).every(m => m.outcome === 'pending')).toBe(true);
});

test('a TOM console offers no next round once TOM has finalized the file', async ({ page }) => {
  const finalized = parseTdf(readFileSync(new URL('../fixtures/tdf/cup-finalized.tdf', import.meta.url), 'utf8'));
  const done = { ...tomManage(), tournament: finalized };
  await tomConsole(page, () => ({ status: 200, json: { ...done, version: 5, revision: 'next' } }), { manage: done });
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pair / })).toHaveCount(0);
});

for (const suffix of ['', '?screen=1', '?stream=table&table=1']) {
  test(`live data discloses failed checks and Retry recovers ${suffix || 'public page'}`, async ({ page }) => {
    await mockApi(page);
    await page.clock.install();
    await page.goto(`/t/${CODE}${suffix}`);
    await expect(
      page.locator(suffix.includes('stream') ? '.tm-stream' : suffix ? '.tm-screen' : '.tm-public')
    ).toBeVisible();
    await page.route(`**/api/tournaments/${CODE}?since=*`, route => route.abort());
    await page.clock.fastForward(11_000);
    await expect(page.locator('.tm-live-data')).toHaveCount(0);
    await page.clock.fastForward(30_000);
    await expect(page.getByText('Connection unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Last updated', { exact: false })).toBeVisible();
    await page.route(`**/api/tournaments/${CODE}?since=*`, route => route.fulfill({ status: 204 }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.tm-live-data')).toHaveCount(0);
  });
}

function largeDisplayView(): TournamentView {
  const players = Array.from({ length: 64 }, (_, i) => ({
    ...VIEW.tournament.players[0]!,
    id: `player-${i}`,
    firstName: `Player ${String(i).padStart(2, '0')}`,
    lastName: 'Example',
    droppedAfter: null
  }));
  const pod = VIEW.tournament.pods[0]!;
  const round = pod.rounds.at(-1)!;
  const matches = Array.from({ length: 32 }, (_, i) => ({
    table: i + 1,
    p1: players[i * 2]!.id,
    p2: players[i * 2 + 1]!.id,
    outcome: 'pending' as const,
    timestamp: ''
  }));
  return {
    ...VIEW,
    decks: {},
    tournament: {
      ...VIEW.tournament,
      players,
      pods: [
        {
          ...pod,
          playerIds: players.map(p => p.id),
          rounds: [{ ...round, status: 'paired', startTime: '', clockStartedAt: null, matches }]
        }
      ]
    }
  };
}

test('a large big screen fits dense pages and keeps them stationary under reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await mockApi(page, largeDisplayView());
  await page.goto(`/t/${CODE}?screen=1`);
  const rows = page.locator('.tm-screen-dense li');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);
  await expect(page.locator('.tm-screen-pagination')).toContainText('Page 1 of');
  const first = (await rows.first().textContent()) ?? '';
  await page.clock.fastForward(35_000);
  await expect(rows.first()).toHaveText(first);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(rows.first()).not.toHaveText(first);
  await page.keyboard.press('ArrowLeft');
  await expect(rows.first()).toHaveText(first);
  const bounds = await page.locator('.tm-screen-pagination').boundingBox();
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(1080);
  await expect(page.getByRole('radio', { name: 'Off', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('the big screen hides the site’s head from the first paint, and leaving it brings the head back', async ({
  page
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const shifts = { total: 0 };
    Object.assign(window, { shifts });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[]) {
        shifts.total += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await mockApi(page, largeDisplayView());
  const held = deferred<void>();
  await page.route(`**/${chunkOf('src/pages/tournaments/BigScreen.tsx')}`, async route => {
    await held.promise;
    await route.continue();
  });
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.site-head')).toBeHidden();
  held.resolve();
  await expect(page.locator('.tm-screen-dense li').first()).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { shifts?: { total: number } }).shifts?.total)).toBeLessThan(
    0.01
  );
  await page.evaluate(() => {
    const link = Object.assign(document.createElement('a'), { href: '/privacy', textContent: 'Privacy' });
    document.body.append(link);
  });
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await expect(page.locator('.site-head')).toBeVisible();
});

function presetView(): TournamentView {
  const view = largeDisplayView();
  view.settings = {
    ...view.settings,
    display: {
      id: 'tv',
      name: 'Wall TV',
      storeId: 'store',
      options: { scale: 1.5, layout: 'alphabetical', pageSeconds: 15 }
    }
  };
  return view;
}

test('a timed preset under reduced motion stands still until resumed, and pauses on the page it shows', async ({
  page
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await mockApi(page, presetView());
  await page.goto(`/t/${CODE}?screen=1`);
  const rows = page.locator('.tm-screen-dense li');
  const pager = page.locator('.tm-screen-pagination');
  await expect(rows.first()).toBeVisible();
  expect(await page.locator('.tm-screen-dense').evaluate(el => getComputedStyle(el).fontSize)).toBe('48px');
  await page.clock.fastForward(16_000);
  await expect(pager).toContainText('Page 1 of');
  await page.getByRole('button', { name: 'Resume pages' }).click();
  await page.clock.fastForward(16_000);
  await expect(pager).toContainText('Page 2 of');
  await page.getByRole('button', { name: 'Pause pages' }).click();
  await page.clock.fastForward(32_000);
  await expect(pager).toContainText('Page 2 of');
  await expect(page.getByRole('button', { name: 'Resume pages' })).toBeVisible();
  // A smaller screen keeps the first row it showed in view rather than starting over.
  const firstShown = (await rows.first().textContent()) ?? '';
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(pager).not.toContainText('Page 1 of');
  await expect(rows.filter({ hasText: firstShown })).toHaveCount(1);
});

test('timed pages turn on their own, and Auto scroll Off stops them where they are', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install();
  await mockApi(page, presetView());
  await page.goto(`/t/${CODE}?screen=1`);
  const pager = page.locator('.tm-screen-pagination');
  await expect(pager).toContainText('Page 1 of');
  await page.clock.fastForward(16_000);
  await expect(pager).toContainText('Page 2 of');
  await page.mouse.move(400, 400);
  await page.getByRole('radio', { name: 'Off', exact: true }).click();
  await page.clock.fastForward(32_000);
  await expect(pager).toContainText('Page 2 of');
  await expect(page.getByRole('button', { name: 'Resume pages' })).toBeVisible();
});

test('the display reacquires its wake lock after returning to view', async ({ page }) => {
  await page.addInitScript(() => {
    let asks = 0;
    let current: EventTarget;
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: async () => {
          asks += 1;
          current = new EventTarget();
          return Object.assign(current, { release: async () => current.dispatchEvent(new Event('release')) });
        }
      }
    });
    Object.assign(window, {
      wakeTest: {
        asks: () => asks,
        hide: () => {
          hidden = true;
          current.dispatchEvent(new Event('release'));
          document.dispatchEvent(new Event('visibilitychange'));
        },
        show: () => {
          hidden = false;
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }
    });
  });
  await mockApi(page);
  await page.goto(`/t/${CODE}?screen=1`);
  const asks = () => page.evaluate(() => (window as unknown as { wakeTest: { asks: () => number } }).wakeTest.asks());
  await expect.poll(asks).toBe(1);
  await page.evaluate(() => (window as unknown as { wakeTest: { hide: () => void } }).wakeTest.hide());
  await page.evaluate(() => (window as unknown as { wakeTest: { show: () => void } }).wakeTest.show());
  await expect.poll(asks).toBe(2);
});

test('setup recovers after cancel and reload and refuses invalid minutes @mobile', async ({ page }) => {
  const submissions = await mockOrganizer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Recovered setup');
  await page.locator('#setup-starts').fill('2026-10-18T12:00');
  const minutes = page.getByRole('spinbutton', { name: 'Swiss round minutes' });
  await minutes.fill('');
  await expect(page.getByRole('button', { name: 'Create event' })).toBeDisabled();
  await page.locator('.tm-setup').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true })));
  expect(submissions).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue('Recovered setup');
  await expect(page.locator('#setup-starts')).toHaveValue('2026-10-18T12:00');
  await expect(minutes).toHaveValue('');
  await minutes.fill('30.5');
  await expect(page.getByRole('button', { name: 'Create event' })).toBeDisabled();
  await minutes.fill('35');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.locator('.tm-error')).toHaveText('Fixture submission');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(minutes).toHaveValue('35');
});

test('community setup shows an occupied date before creation @mobile', async ({ page }) => {
  await mockOrganizer(page);
  await page.route('**/api/me', route =>
    route.fulfill({
      json: {
        user: { id: 'community', name: 'Community', role: 'community', stores: [] },
        providers: []
      }
    })
  );
  await page.route('**/api/tournaments', route =>
    route.fulfill({
      json: {
        tournaments: [
          {
            code: 'TAKEND',
            name: 'Existing event',
            mode: 'swiss',
            role: 'owner',
            players: 0,
            startDate: '10/18/2026',
            communityDay: '2026-10-18',
            finished: true,
            rounds: 0,
            updatedAt: 0
          }
        ]
      }
    })
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Next event');
  await page.locator('#setup-starts').fill('2026-10-18T12:00');
  await expect(page.getByText('One community event per date', { exact: false })).toBeVisible();
  await expect(page.getByText('An event already uses 2026-10-18.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create event' })).toBeDisabled();
  await page.locator('#setup-starts').fill('2026-10-19T12:00');
  await expect(page.getByRole('button', { name: 'Create event' })).toBeEnabled();
});

test('successful creation clears the setup draft', async ({ page }) => {
  await mockOrganizer(page);
  await page.route('**/api/tournaments', route =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: { code: CODE } })
      : route.fulfill({ json: { tournaments: [] } })
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Created event');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(new RegExp(`/host/${CODE}`));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue('');
  await expect(page.getByRole('spinbutton', { name: 'Swiss round minutes' })).toHaveValue('30');
});

test('TOM creation opens the known event when handle persistence fails', async ({ page }) => {
  await mockOrganizer(page);
  await page.addInitScript(source => {
    Object.assign(window, {
      showOpenFilePicker: async () => [{ name: 'event.tdf', getFile: async () => new File([source], 'event.tdf') }]
    });
    indexedDB.open = () => {
      throw new Error('Storage unavailable');
    };
  }, TDF_SOURCE);
  await page.route('**/api/tournaments', route =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: { code: CODE } })
      : route.fulfill({ json: { tournaments: [] } })
  );
  await page.route(`**/api/tournaments/${CODE}/manage*`, route =>
    new URL(route.request().url()).searchParams.has('since')
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: tomManage() })
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Link .tdf file' }).click();
  await page.getByRole('checkbox', { name: 'I’ve created this event in Play! Tools' }).check();
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(new RegExp(`/host/${CODE}`));
  await expect(page.getByRole('region', { name: 'TOM file' })).toContainText('Manual snapshot');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('cm-event-setup:')))).toEqual(
    []
  );
});

test('automatic TOM polling preserves the last import timestamp and manual upload stops following', async ({
  page
}) => {
  await page.clock.install();
  let syncs = 0;
  const manual: unknown[] = [];
  await tomConsole(page, body => {
    syncs += 1;
    manual.push((JSON.parse(body) as { manual?: boolean }).manual);
    return { status: 200, json: { ...tomManage(), version: 5, revision: 'next' } };
  });
  const strip = page.getByRole('region', { name: 'TOM file' });
  await expect(strip).toContainText('Automatically following');
  await expect(strip).toContainText('Last imported');
  const before = await strip.locator('.tm-file-line').innerText();
  await page.clock.fastForward(10_000);
  expect(await strip.locator('.tm-file-line').innerText()).toBe(before);
  expect(syncs).toBe(1);
  await strip.getByRole('button', { name: 'More' }).click();
  await strip
    .locator('input[type="file"]')
    .setInputFiles({ name: 'manual.tdf', mimeType: 'text/xml', buffer: Buffer.from(TDF_SOURCE) });
  await expect(strip).toContainText('Manual snapshot');
  await expect(strip.getByRole('button', { name: 'Link .tdf file' })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Refresh .tdf' })).toHaveCount(0);
  expect(syncs).toBe(2);
  await page.clock.fastForward(10_000);
  expect(syncs).toBe(2);
  // Following the file is not an import the organizer chose; uploading one is, even unchanged.
  expect(manual).toEqual([undefined, true]);
});

test('manual TOM uploads show browser capability and the imported snapshot time', async ({ page }) => {
  const lastImportAt = Date.parse('2026-10-14T14:00:00Z');
  await tomConsole(
    page,
    () => ({ status: 200, json: { ...tomManage(), lastImportAt, version: 5, revision: 'next' } }),
    { following: false }
  );
  const strip = page.getByRole('region', { name: 'TOM file' });
  await expect(strip).toContainText('Manual snapshot');
  await expect(strip).toContainText('This browser cannot follow files');
  await expect(strip.getByRole('button', { name: 'Link .tdf file' })).toHaveCount(0);
  const before = await strip.locator('.tm-file-line').innerText();
  await strip
    .locator('input[type="file"]')
    .setInputFiles({ name: 'manual.tdf', mimeType: 'text/xml', buffer: Buffer.from(TDF_SOURCE) });
  await expect(strip.locator('.tm-file-line')).not.toHaveText(before);
  await expect(strip).toContainText('Manual snapshot');
});

test('a failed manual upload preserves automatic TOM following', async ({ page }) => {
  let syncs = 0;
  await tomConsole(page, () => {
    syncs += 1;
    return synced();
  });
  const strip = page.getByRole('region', { name: 'TOM file' });
  await expect(strip).toContainText('Automatically following');
  await strip.getByRole('button', { name: 'More' }).click();
  await strip
    .locator('input[type="file"]')
    .setInputFiles({ name: 'broken.tdf', mimeType: 'text/xml', buffer: Buffer.from('<broken>') });
  await expect(strip).toContainText('Could not parse the .tdf');
  await expect(strip).toContainText('Automatically following');
  expect(syncs).toBe(1);
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('Fixture Challenge', 'Updated Challenge');
    file.modified += 1;
  });
  await strip.getByRole('button', { name: 'Refresh .tdf' }).click();
  await expect.poll(() => syncs).toBe(2);
  await expect(strip.locator('.tm-error')).toHaveCount(0);
});

test('setup asks where and when, starting in the store’s zone, and keeps the answers', async ({ page }) => {
  const submissions = await mockOrganizer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  await expect(zone).toHaveValue('America/Chicago');
  await page.getByRole('textbox', { name: 'Event name' }).fill('Sunday Cup');
  await page.getByRole('textbox', { name: 'Venue' }).fill('Test Games');
  await page.getByRole('textbox', { name: 'Address' }).fill('100 Main Street');
  await page.locator('#setup-check-in').fill('2026-10-18T11:30');
  await zone.selectOption('Europe/London');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page.getByRole('textbox', { name: 'Venue' })).toHaveValue('Test Games');
  await expect(zone).toHaveValue('Europe/London');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.locator('.tm-error')).toHaveText('Fixture submission');
  expect(submissions).toEqual([
    expect.objectContaining({
      settings: expect.objectContaining({
        timeZone: 'Europe/London',
        venue: 'Test Games',
        address: '100 Main Street',
        checkInAt: '2026-10-18T11:30'
      })
    })
  ]);
});

test.describe('a viewer in another time zone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('sees the venue and each time in the event’s zone and their own @mobile', async ({ page }) => {
    const settings = {
      ...VIEW.settings,
      timeZone: 'America/Chicago',
      startsAt: '2026-10-18T12:00',
      checkInAt: '2026-10-18T11:30',
      venue: 'Test Games',
      address: '100 Main Street'
    };
    await mockApi(page, { ...VIEW, settings });
    await page.goto(`/t/${CODE}`);
    const logistics = page.locator('.tm-logistics');
    await expect(logistics.getByRole('row', { name: /Venue/ })).toContainText('Test Games100 Main Street');
    await expect(logistics.getByRole('row', { name: /Check-in/ })).toContainText('11:30 AM CDT');
    await expect(logistics.getByRole('row', { name: /Check-in/ })).toContainText('Your time: Sun, Oct 18, 9:30 AM PDT');
    await expect(logistics.getByRole('row', { name: /Starts/ })).toContainText('Your time: Sun, Oct 18, 10:00 AM PDT');
    await expect(page.locator('.hero-meta')).toContainText('12:00 PM CDT');
  });

  test('sees an event without a zone as it was written, with no second time', async ({ page }) => {
    await mockApi(page, {
      ...VIEW,
      settings: { ...VIEW.settings, startsAt: '2026-10-18T12:00', checkInAt: '2026-10-18T11:30' }
    });
    await page.goto(`/t/${CODE}`);
    await expect(page.locator('.tm-logistics')).toContainText('11:30 AM');
    await expect(page.locator('.tm-logistics')).not.toContainText('Your time');
  });
});

test('with divisions on their own clocks, the running one leads and the one waiting says so', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const pod = VIEW.tournament.pods[0]!;
  const round = pod.rounds.at(-1)!;
  const division = (category: 'masters' | 'senior', clock: Partial<typeof round>) => ({
    ...pod,
    category,
    rounds: [...pod.rounds.slice(0, -1), { ...round, ...clock }]
  });
  const view: TournamentView = {
    ...VIEW,
    tournament: {
      ...VIEW.tournament,
      pods: [
        division('masters', { startTime: '', clockStartedAt: null, timeLeft: 3000 }),
        division('senior', { startTime: '10:00', clockStartedAt: Date.now(), timeLeft: 2322 })
      ]
    }
  };
  await mockApi(page, view);
  await page.goto(`/t/${CODE}?screen=1`);
  const lead = page.locator('.tm-screen-big-clock.is-divisions > div');
  await expect(lead.locator('p')).toHaveText('Seniors · Round 2');
  await expect(lead.getByRole('timer')).toHaveText(/^3[0-8]:\d\d$/);
  const side = page.locator('.tm-screen-side-clocks li');
  await expect(side).toHaveCount(1);
  await expect(side.first()).toContainText('Not started');
  await expect(side.first().locator('p')).toHaveText('Masters · Round 2');
});

test('a store event picks its big screen preset on the Settings tab', async ({ page }) => {
  await tomConsole(page, () => ({ status: 200, json: tomManage() }), { following: false });
  const preset = { id: 'wall', name: 'Wall TV', options: { scale: 1.5, layout: 'alphabetical', pageSeconds: 15 } };
  const picked: unknown[] = [];
  await page.route(`**/api/tournaments/${CODE}/display`, route => {
    if (route.request().method() === 'PUT') {
      picked.push(route.request().postDataJSON());
      const display = { ...preset, storeId: 'store-1' };
      return route.fulfill({ json: { ...tomManage(), settings: { ...DEFAULT_SETTINGS, display } } });
    }
    return route.fulfill({ json: { presets: [preset], selected: null } });
  });
  await page.getByRole('tab', { name: 'Settings' }).click();
  const select = page.getByLabel('Display preset');
  await expect(select).toHaveValue('');
  await select.selectOption('wall');
  await page.locator('section', { hasText: 'Big screen' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => picked).toEqual([{ preset: 'wall' }]);
  await expect(select).toHaveValue('wall');
  await expect(page.locator('section', { hasText: 'Big screen' }).getByText('Unsaved changes')).toHaveCount(0);
});

test('a refused big screen preset save keeps the pick unsaved to try again', async ({ page }) => {
  await tomConsole(page, () => ({ status: 200, json: tomManage() }), { following: false });
  const preset = { id: 'wall', name: 'Wall TV', options: { scale: 1.5, layout: 'alphabetical', pageSeconds: 15 } };
  await page.route(`**/api/tournaments/${CODE}/display`, route =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: 'Try again shortly' } })
      : route.fulfill({ json: { presets: [preset], selected: null } })
  );
  await page.getByRole('tab', { name: 'Settings' }).click();
  const box = page.locator('section', { hasText: 'Big screen' });
  const select = page.getByLabel('Display preset');
  await expect(select.locator('option', { hasText: 'Wall TV' })).toHaveCount(1);
  await select.selectOption('wall');
  await box.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Try again shortly')).toBeVisible();
  await expect(select).toHaveValue('wall');
  await expect(box.getByText('Unsaved changes')).toBeVisible();
});

test('a sole division whose clock is paused says so under the clock', async ({ page }) => {
  const pod = VIEW.tournament.pods[0]!;
  const round = { ...pod.rounds.at(-1)!, startTime: '10:00', clockStartedAt: null, timeLeft: 1325 };
  const view: TournamentView = {
    ...VIEW,
    tournament: { ...VIEW.tournament, pods: [{ ...pod, rounds: [...pod.rounds.slice(0, -1), round] }] }
  };
  await mockApi(page, view);
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.tm-screen-big-clock').getByRole('timer')).toHaveText('22:05');
  await expect(page.locator('.tm-screen-big-clock p')).toHaveText(/ · Paused$/);
});
