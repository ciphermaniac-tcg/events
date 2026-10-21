/**
 * The tournament pages against mocked functions: the public page shows the
 * current round's tables and a searchable field, opens a player's history,
 * ranks a combined pod per division, and never asks a signed-out player to
 * do more than sign in. The data is the hand-written mid-event .tdf fixture,
 * run through the same public-view code the function uses.
 */

import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';
import { deferred } from '../__utils__/deferred';
import { chunkOf } from './build-manifest';

import { applyCommand } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { lookupPlayers } from '../../shared/tournament/lookup';
import { birthYear } from '../../shared/tournament/divisions';
import { seededRandom } from '../../shared/tournament/random';
import { parseTdf } from '../../shared/tournament/tdf';
import { readTournament } from '../../shared/tournament/validate';
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
import { organizerMe } from './console-fixture';

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
      const claim = route.request().postDataJSON() as {
        lookup?: boolean;
        popId?: string;
        lastName?: string;
        firstName?: string;
      };
      if (claim.lookup) {
        const candidates = lookupPlayers(tdf.players, {
          lastName: claim.lastName ?? '',
          firstName: claim.firstName
        }).map(player => ({ key: keys[player.id], firstName: player.firstName, lastName: player.lastName }));
        return route.fulfill({ json: { candidates, view } });
      }
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
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('lamarr');
  await expect(rows).toHaveCount(1);
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
  // Known now, the viewer is not offered to be anyone else.
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('');
  await page
    .locator('.tm-matches')
    .getByRole('button', { name: /Mary Jackson/ })
    .first()
    .click();
  await expect(sheet).toContainText('Mary Jackson');
  await expect(sheet.getByRole('button', { name: 'This is me' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'This isn’t me' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a player another device already claimed is refused, and the sheet says why', async ({ page }) => {
  await mockApi(page);
  await page.route(`**/api/tournaments/${CODE}/report`, route =>
    route.fulfill({
      status: 409,
      json: { error: 'Another device already claimed this player. Ask staff if that’s wrong.' }
    })
  );
  await page.goto(`/t/${CODE}`);
  await page
    .locator('.tm-matches')
    .getByRole('button', { name: /Hedy Lamarr/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'This is me' }).click();
  await sheet.getByLabel('Player ID').fill(tdf.players.find(p => p.lastName === 'Lamarr')?.id ?? '');
  await sheet.getByLabel('Birth year').fill(yearOf('Lamarr'));
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.locator('.tm-error')).toHaveText(
    'Another device already claimed this player. Ask staff if that’s wrong.'
  );
  await expect(sheet.getByRole('button', { name: 'This isn’t me' })).toHaveCount(0);
});

/** The name Hedy Lamarr's account answers with, exactly hers. */
const HEDY = { firstName: 'Hedy', lastName: 'Lamarr' };

/**
 * An unsanctioned event as a signed-in account sees it whose name is near
 * Hedy Lamarr's: exactly hers, which yes claims her with, or a near miss.
 */
function suggestedView(exact: boolean): TournamentView {
  const hedy = tdf.players.find(p => p.lastName === 'Lamarr')!;
  const suggest = { key: keys[hedy.id]!, ...(exact ? { claim: HEDY } : {}) };
  return {
    ...VIEW,
    settings: { ...VIEW.settings, sanctioned: false },
    viewer: { role: null, me: null, via: null, signedIn: true, suggest }
  };
}

test('an account that looks to be a player is asked, and yes claims them', async ({ page }) => {
  const hedy = tdf.players.find(p => p.lastName === 'Lamarr')!;
  const view = suggestedView(true);
  await mockApi(page, view);
  const asked: Record<string, unknown>[] = [];
  await page.route(`**/api/tournaments/${CODE}/report`, route => {
    asked.push(route.request().postDataJSON() as Record<string, unknown>);
    const { viewer: _viewer, ...published } = view;
    return route.fulfill({ json: { key: keys[hedy.id], view: published, reporter: true, reportToken: 'token' } });
  });
  await page.goto(`/t/${CODE}`);
  const box = page.getByRole('region', { name: 'Your match' });
  await expect(box.getByRole('heading', { name: 'Is this you?' })).toBeVisible();
  await expect(box.locator('.tm-lookup-match')).toContainText('Hedy Lamarr');
  await expect(box.getByLabel('Last name', { exact: true })).toHaveCount(0);
  await box.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.locator('.tm-you-who')).toContainText('Hedy Lamarr');
  expect(asked).toEqual([expect.objectContaining({ ...HEDY, expect: keys[hedy.id] })]);
});

test('yes to a player whose name is only near the account’s shows their table', async ({ page }) => {
  await mockApi(page, suggestedView(false));
  const asked: unknown[] = [];
  await page.route(`**/api/tournaments/${CODE}/report`, route => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, json: { error: 'Not asked' } });
  });
  await page.goto(`/t/${CODE}`);
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.locator('.tm-you-big')).toHaveText(/Table\s*2/);
  await expect(page.getByRole('button', { name: 'Report result' })).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('yes to a player another device holds shows their table, and reporting stays theirs', async ({ page }) => {
  await mockApi(page, suggestedView(true));
  await page.route(`**/api/tournaments/${CODE}/report`, route =>
    route.fulfill({
      status: 409,
      json: { error: 'Another device already claimed this player. Ask staff if that’s wrong.' }
    })
  );
  await page.goto(`/t/${CODE}`);
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.locator('.tm-you-big')).toHaveText(/Table\s*2/);
  await expect(page.locator('.tm-you-who')).toContainText('Hedy Lamarr');
});

test('no to a suggested player goes back to asking which player, and is remembered', async ({ page }) => {
  await mockApi(page, suggestedView(false));
  await page.goto(`/t/${CODE}`);
  await page.getByRole('button', { name: 'Not me' }).click();
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Is this you?' })).toHaveCount(0);
});

test('once the event is done nobody is asked which player they are', async ({ page }) => {
  await mockApi(page, { ...VIEW, settings: { ...VIEW.settings, finished: true } });
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-standings, .tm-matches, .tm-status').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your match' })).toHaveCount(0);
});

test('retrying a lost identify response restores reporting and remembers the recovered token', async ({ page }) => {
  const view = { ...VIEW, settings: { ...VIEW.settings, playerReporting: true } };
  await mockApi(page, view);
  await publish(page, () => view);
  const mary = tdf.players.find(player => player.lastName === 'Jackson');
  const requests: { lookup?: boolean; device: string; reportToken?: string; result?: string }[] = [];
  await page.route(`**/api/tournaments/${CODE}/report`, route => {
    const body = route.request().postDataJSON() as (typeof requests)[number];
    if (body.lookup) {
      return route.fulfill({
        json: { candidates: [{ key: keys[mary?.id ?? ''], firstName: 'Mary', lastName: 'Jackson' }], view }
      });
    }
    requests.push(body);
    if (requests.length === 1) {
      return route.abort('connectionreset');
    }
    return route.fulfill({ json: { key: keys[mary?.id ?? ''], view, reporter: true, reportToken: body.device } });
  });
  await page.goto(`/t/${CODE}`);
  await page.getByLabel('Last name', { exact: true }).fill('Jackson');
  await page.getByRole('button', { name: 'Find my match' }).click();
  await page.getByRole('button', { name: 'Show table' }).click();
  await page.getByRole('button', { name: 'Report result' }).click();
  await page.getByLabel('Player ID', { exact: true }).fill(mary?.id ?? '');
  await page.getByLabel('Birth year').fill(yearOf('Jackson'));
  await page.getByRole('button', { name: 'Confirm reporting player' }).click();
  await expect(page.locator('.tm-you-panel .tm-error')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm reporting player' }).click();
  await expect(page.getByRole('button', { name: 'I won', exact: true })).toBeVisible();
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
  // The sample event plays on the real engine, opening already paired on the big screen.
  const screen = page.getByRole('img', { name: 'A sample event on the big screen' });
  await expect(screen.locator('.tm-hs-tables li')).toHaveCount(6);
  await expect(screen.locator('.tm-hs-status')).toContainText('Round 1 of 5');
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
  const reason = page.locator('.tm-setup-foot').getByText('Confirm the event is in Play! Tools to create it');
  await expect(reason).toBeVisible();
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
  await expect(reason).toHaveCount(0);
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

test('a sanctioned setup asks who pairs: TOM goes on from its file, and Ciphermaniac comes back', async ({ page }) => {
  await mockOrganizer(page);
  await page.addInitScript(source => {
    Object.assign(window, {
      showOpenFilePicker: async () => [{ name: 'event.tdf', getFile: async () => new File([source], 'event.tdf') }]
    });
  }, TDF_SOURCE);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const pairing = page.getByRole('radiogroup', { name: 'Pairing and results', exact: true });
  await expect(pairing).toHaveCount(0);
  const sanctioned = page.getByRole('radiogroup', { name: 'Sanctioned', exact: true });
  await sanctioned.getByRole('radio', { name: 'Yes', exact: true }).click();
  await expect(pairing.getByRole('radio', { name: 'Ciphermaniac', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.getByRole('note', { name: /^Where rounds are paired and results are kept\./ })).toHaveCount(1);
  await expect(page.getByText('Can’t be changed after the event is created')).toBeVisible();
  await pairing.getByRole('radio', { name: 'TOM', exact: true }).click();
  await expect(page.getByText('From the .tdf')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Swiss round minutes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create event' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Link .tdf file' }).click();
  await expect(page.locator('.tm-setup-file')).toContainText('Fixture Challenge');
  await expect(pairing.getByRole('radio', { name: 'TOM', exact: true })).toHaveAttribute('aria-checked', 'true');
  await pairing.getByRole('radio', { name: 'Ciphermaniac', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toBeVisible();
  await expect(pairing.getByRole('radio', { name: 'Ciphermaniac', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await sanctioned.getByRole('radio', { name: 'No', exact: true }).click();
  await expect(pairing).toHaveCount(0);
});

test('a sanctioned setup narrowed past where TOM runs goes back to pairing here', async ({ page }) => {
  await mockOrganizer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page
    .getByRole('radiogroup', { name: 'Sanctioned', exact: true })
    .getByRole('radio', { name: 'Yes', exact: true })
    .click();
  const pairing = page.getByRole('radiogroup', { name: 'Pairing and results', exact: true });
  await pairing.getByRole('radio', { name: 'TOM', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create event' })).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(pairing).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Event name' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create event' })).toBeVisible();
});

test('a TOM setup reached from a Swiss one keeps the store picked there', async ({ page }) => {
  await mockOrganizer(page);
  await page.route('**/api/me', route =>
    route.fulfill({
      json: {
        user: {
          id: 'organizer',
          name: 'Organizer',
          role: null,
          stores: ['store-1', 'store-2'].map((id, i) => ({
            id,
            name: `Test Games ${i + 1}`,
            leagueId: `100000${i + 1}`,
            status: 'active',
            timeZone: 'America/Chicago',
            role: 'manager'
          }))
        },
        providers: []
      }
    })
  );
  await page.addInitScript(source => {
    Object.assign(window, {
      showOpenFilePicker: async () => [{ name: 'event.tdf', getFile: async () => new File([source], 'event.tdf') }]
    });
  }, TDF_SOURCE);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page.getByRole('combobox', { name: 'Run as' }).selectOption('store-2');
  await page
    .getByRole('radiogroup', { name: 'Sanctioned', exact: true })
    .getByRole('radio', { name: 'Yes', exact: true })
    .click();
  await page
    .getByRole('radiogroup', { name: 'Pairing and results', exact: true })
    .getByRole('radio', { name: 'TOM', exact: true })
    .click();
  await page.getByRole('button', { name: 'Link .tdf file' }).click();
  await expect(page.locator('.tm-setup-file')).toContainText('Fixture Challenge');
  await expect(page.getByRole('combobox', { name: 'Run as' })).toHaveValue('store-2');
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
  // The page behind is inert, as a native modal's is: assistive tech reaches only the sheet.
  const tabs = page.getByRole('tablist', { name: 'Event sections' });
  await expect(page.locator('.site-head')).toHaveJSProperty('inert', true);
  await expect(page.locator('.tabs')).toHaveJSProperty('inert', true);
  expect(await page.getByRole('heading', { level: 1 }).evaluate(el => el.closest('[inert]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.tabs')).toHaveJSProperty('inert', false);
  await expect(tabs).toBeVisible();
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

/** A console following a linked file; `sync` answers each sync, and null leaves one hanging. */
async function tomConsole(
  page: Page,
  sync: (body: string) => SyncAnswer | Promise<SyncAnswer>,
  { manage = tomManage(), following = true }: { manage?: unknown; following?: boolean } = {}
) {
  await page.addInitScript(source => {
    const kept = sessionStorage.getItem('tdfFile');
    const file = kept
      ? (JSON.parse(kept) as { modified: number; lost: string | null; text: string; reads: number })
      : { modified: 1, lost: null as string | null, text: source, reads: 0 };
    addEventListener('pagehide', () => sessionStorage.setItem('tdfFile', JSON.stringify(file)));
    Object.assign(window, {
      tdfFile: file,
      showOpenFilePicker: async () => [
        {
          name: 'event.tdf',
          getFile: async () => {
            file.reads += 1;
            // `lost` names the error the browser throws: taken back (NotAllowedError) or moved (NotFoundError).
            if (file.lost) {
              throw new DOMException('The file cannot be read', file.lost);
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
      return route.fulfill({ json: organizerMe({ publicProfile: false, profileName: 'real' }) });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/sync`) {
      return Promise.resolve(sync(route.request().postData() ?? '')).then(answer =>
        answer ? route.fulfill(answer) : undefined
      );
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

/** The Settings tab's TOM section, where the file is read again, swapped for another or unlinked. */
async function tomFile(page: Page) {
  await page.getByRole('tab', { name: 'Settings' }).click();
  return page.getByRole('region', { name: 'TOM', exact: true });
}

/** How long ago TOM saved, in the console's head. */
const saved = (page: Page) => page.locator('.tm-saved');

/** The open tables of the file's latest round, with results entered on the site that TOM does not have yet. */
function openPending() {
  const pod = tdf.pods[0]!;
  const round = pod.rounds.at(-1)!;
  return round.matches
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
}

/** TOM saves its file: the same text, unless `text` says otherwise, at a later modified time. */
const tomSaves = (page: Page, text?: string) =>
  page.evaluate(next => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = next ?? file.text;
    file.modified = Math.max(file.modified + 1, Date.now());
  }, text);

test('a TOM console stops following its file when another copy was synced over it, and asks before replacing it', async ({
  page
}) => {
  let syncs = 0;
  await tomConsole(page, () => {
    syncs += 1;
    return { status: 409, json: { error: 'The site has a different copy of this event.' } };
  });
  await expect(page.getByText('The site has a different copy of this event.')).toBeVisible();
  await expect(page.locator('.hero-meta')).toContainText('reconnect the .tdf to enter results');
  await page.getByRole('button', { name: 'Reconnect event.tdf' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace the site’s copy with event.tdf?' });
  await expect(dialog).toContainText('Another device synced this event at');
  await expect(dialog).toContainText('replaces that copy with event.tdf from this computer.');
  await dialog.getByRole('button', { name: 'Keep' }).click();
  await expect(dialog).toBeHidden();
  expect(syncs).toBe(1);
  await page.getByRole('button', { name: 'Reconnect event.tdf' }).click();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect.poll(() => syncs).toBe(2);
});

test('a linked file older than the site’s copy, and different, waits to be reconnected instead of replacing it', async ({
  page
}) => {
  let syncs = 0;
  // The site holds a later copy: one more player than the file, synced after the file was last saved.
  const later = { ...tdf, players: [...tdf.players, { ...tdf.players[0]!, id: '9100000001', lastName: 'Later' }] };
  await tomConsole(
    page,
    () => {
      syncs += 1;
      return synced();
    },
    { manage: { ...tomManage(), tournament: later } }
  );
  await expect(page.locator('.hero-meta')).toContainText('reconnect the .tdf to enter results');
  expect(syncs).toBe(0);
  await page.getByRole('button', { name: 'Reconnect event.tdf' }).click();
  await page
    .getByRole('dialog', { name: 'Replace the site’s copy with event.tdf?' })
    .getByRole('button', { name: 'Replace' })
    .click();
  await expect.poll(() => syncs).toBe(1);
});

test('a linked file older than the site’s copy but holding the same event keeps being followed', async ({ page }) => {
  let syncs = 0;
  // The site's copy as the functions store it: the same event, its fields in the order readTournament writes them.
  const stored = readTournament(JSON.parse(JSON.stringify(tdf)) as unknown);
  await tomConsole(
    page,
    () => {
      syncs += 1;
      return synced();
    },
    { manage: { ...tomManage(), tournament: stored } }
  );
  await expect.poll(() => syncs).toBe(1);
  await expect(page.locator('.hero-meta')).not.toContainText('reconnect the .tdf');
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
  const file = await tomFile(page);
  await expect(file.getByRole('button', { name: 'Refresh .tdf' })).toBeVisible();
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('Fixture Challenge', 'Saved After');
    file.modified = 2;
  });
  const reads = () => page.evaluate(() => (window as unknown as { tdfFile: { reads: number } }).tdfFile.reads);
  const before = await reads();
  await file.getByRole('button', { name: 'Refresh .tdf' }).click();
  // A sync only ever follows a read of the file, and a refresh starts its read as it is clicked.
  expect(await reads()).toBe(before);
  expect(syncs).toBe(0);
});

test('a TOM console holds off results when the browser takes back the file', async ({ page }) => {
  await tomConsole(page, () => ({ status: 200, json: { ...tomManage(), version: 5, revision: 'next' } }));
  await expect(saved(page)).toContainText('Saved by TOM');
  await page.evaluate(() => {
    (window as unknown as { tdfFile: { lost: string } }).tdfFile.lost = 'NotAllowedError';
  });
  await expect(page.getByRole('button', { name: 'Allow access to event.tdf' })).toBeVisible();
  await expect(saved(page)).toContainText('event.tdf needs access again');
  await expect(page.locator('.hero-meta')).toContainText('allow access to the .tdf to enter results');
});

test('a TOM console whose file was moved asks for it to be picked again', async ({ page }) => {
  let syncs = 0;
  await tomConsole(page, () => {
    syncs += 1;
    return synced();
  });
  await expect(saved(page)).toContainText('Saved by TOM');
  await page.evaluate(() => {
    (window as unknown as { tdfFile: { lost: string } }).tdfFile.lost = 'NotFoundError';
  });
  await expect(saved(page)).toContainText('event.tdf can’t be read');
  await expect(page.locator('.hero-meta')).toContainText('pick the .tdf again to enter results');
  await page.evaluate(() => {
    (window as unknown as { tdfFile: { lost: null; modified: number } }).tdfFile.lost = null;
  });
  // Picking it again opens the file picker, here the same file found again.
  await page.getByRole('button', { name: 'Pick event.tdf again' }).click();
  await expect(page.getByRole('button', { name: 'Pick event.tdf again' })).toHaveCount(0);
  await expect.poll(() => syncs).toBe(2);
});

test('a TOM upload saved before the site’s copy asks before replacing it', async ({ page }, testInfo) => {
  let syncs = 0;
  await tomConsole(
    page,
    () => {
      syncs += 1;
      return synced();
    },
    { following: false }
  );
  const older = testInfo.outputPath('older.tdf');
  writeFileSync(older, TDF_SOURCE);
  const before = new Date('2026-10-13T12:00:00Z');
  utimesSync(older, before, before);
  const input = page.locator('.tm-tom-status input[type="file"]');
  await input.setInputFiles(older);
  const dialog = page.getByRole('dialog', { name: 'Replace the site’s copy with older.tdf?' });
  await expect(dialog).toContainText('after older.tdf was last saved.');
  await dialog.getByRole('button', { name: 'Keep' }).click();
  expect(syncs).toBe(0);
  await input.setInputFiles(older);
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect.poll(() => syncs).toBe(1);
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
  const file = await tomFile(page);
  await expect(file.getByRole('button', { name: 'Refresh .tdf' })).toBeVisible();
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
  await file.getByRole('button', { name: 'Refresh .tdf' }).click();
  release();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toContain('Saved Twice');
});

test('a TOM console says when the file TOM saved does not parse', async ({ page }) => {
  await tomConsole(page, synced);
  await expect(saved(page)).toContainText('Saved by TOM');
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('outcome="1"', 'outcome="7"');
    file.modified = 2;
  });
  await expect(page.getByText('Could not parse the .tdf: Unknown match outcome "7"')).toBeVisible();
});

test('a TOM console never offers to pair a round, even with every result in', async ({ page }) => {
  const pending = openPending();
  await tomConsole(page, () => ({ status: 200, json: { ...tomManage(), pending, version: 5, revision: 'next' } }), {
    manage: { ...tomManage(), pending }
  });
  await expect(saved(page)).toContainText('Saved by TOM');
  await expect(page.getByRole('button', { name: /^Pair / })).toHaveCount(0);
});

test('a TOM console says when TOM last saved, how often once it has seen, and when TOM goes quiet', async ({
  page
}) => {
  await page.clock.install({ time: Date.parse('2026-10-15T20:30:00Z') });
  await tomConsole(page, synced);
  /** TOM saves now, and the head has read that save once it shows the save's time. */
  const saveRead = async () => {
    await tomSaves(page);
    const at = await page.evaluate(() => new Date().toLocaleTimeString('en', { timeStyle: 'short' }));
    await expect(saved(page)).toContainText(`Saved by TOM just now${at}`);
  };
  await saveRead();
  await expect(saved(page)).not.toContainText('TOM saves about every');
  for (let save = 0; save < 2; save += 1) {
    await page.clock.fastForward(5 * 60_000);
    await saveRead();
  }
  await expect(saved(page)).toContainText('TOM saves about every 5 min');
  await expect(saved(page)).not.toHaveClass(/is-late/);
  await page.clock.fastForward(11 * 60_000);
  await expect(saved(page)).toContainText('Saved by TOM 11 min ago');
  await expect(saved(page)).toContainText('TOM usually saves every 5 min');
  await expect(saved(page)).toHaveClass(/is-late/);
});

test('a TOM console writes results into the file only once TOM is closed, and holds them until TOM saves them', async ({
  page
}) => {
  const pending = openPending();
  let answer = { ...tomManage(), pending, version: 5, revision: 'next' };
  const bodies: string[] = [];
  await tomConsole(
    page,
    body => {
      bodies.push(body);
      return { status: 200, json: answer };
    },
    { manage: { ...tomManage(), pending } }
  );
  const write = page.getByRole('button', { name: 'Write 2 results to .tdf' });
  await write.click();
  const ask = page.getByRole('group', { name: 'Write results to the .tdf' });
  await expect(ask).toContainText('Close the event in TOM first, then reopen the .tdf in TOM once it’s written.');
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(write).toBeFocused();
  await write.click();
  await ask.getByRole('button', { name: 'TOM is closed, write' }).click();
  await expect(saved(page)).toContainText('Results written · reopen the .tdf in TOM');
  const text = await page.evaluate(() => (window as unknown as { tdfFile: { text: string } }).tdfFile.text);
  const [, second] = parseTdf(text).pods[0]!.rounds;
  expect(second?.matches.every(m => m.outcome !== 'pending')).toBe(true);
  // The written file is not a save of TOM's: reading it again sends nothing, so the results stay pending.
  const sent = bodies.length;
  await (await tomFile(page)).getByRole('button', { name: 'Refresh .tdf' }).click();
  await page.getByRole('tab', { name: 'Pairings' }).click();
  expect(bodies.length).toBe(sent);
  // Writing again before TOM has saved sends nothing either: the file is still this page's own write.
  const modified = () => page.evaluate(() => (window as unknown as { tdfFile: { modified: number } }).tdfFile.modified);
  const before = await modified();
  await write.click();
  await ask.getByRole('button', { name: 'TOM is closed, write' }).click();
  await expect(write).toBeFocused();
  await expect.poll(modified).toBeGreaterThan(before);
  expect(bodies.length).toBe(sent);
  // TOM opens the file again and saves it, results and all.
  answer = { ...tomManage(), pending: [], version: 6, revision: 'saved' };
  await tomSaves(page);
  await expect.poll(() => bodies.length).toBe(sent + 1);
  await expect(saved(page)).not.toContainText('Results written');
  await expect(write).toHaveCount(0);
});

test('a TOM console remembers its write across a reload, and sends it up only once TOM has saved', async ({ page }) => {
  const pending = openPending();
  const bodies: string[] = [];
  await tomConsole(
    page,
    body => {
      bodies.push(body);
      return { status: 200, json: { ...tomManage(), pending, version: 5, revision: 'next' } };
    },
    { manage: { ...tomManage(), pending } }
  );
  const original = await page.evaluate(() => (window as unknown as { tdfFile: { text: string } }).tdfFile.text);
  await page.getByRole('button', { name: 'Write 2 results to .tdf' }).click();
  await page.getByRole('button', { name: 'TOM is closed, write' }).click();
  await expect(saved(page)).toContainText('Results written · reopen the .tdf in TOM');
  const sent = bodies.length;
  await page.reload();
  // The page could not keep the file's handle, so the organizer links it again.
  await page.getByRole('button', { name: 'Link .tdf file' }).click();
  await expect(saved(page)).toContainText('Results written · reopen the .tdf in TOM');
  expect(bodies.length).toBe(sent);
  await tomSaves(page, original);
  await expect(saved(page)).toContainText('TOM saved over the written results');
});

test('a TOM console says when TOM, left open, saved over the results written into its file', async ({ page }) => {
  const pending = openPending();
  await tomConsole(page, () => ({ status: 200, json: { ...tomManage(), pending, version: 5, revision: 'next' } }), {
    manage: { ...tomManage(), pending }
  });
  const original = await page.evaluate(() => (window as unknown as { tdfFile: { text: string } }).tdfFile.text);
  await page.getByRole('button', { name: 'Write 2 results to .tdf' }).click();
  await page.getByRole('button', { name: 'TOM is closed, write' }).click();
  await expect(saved(page)).toContainText('Results written · reopen the .tdf in TOM');
  await tomSaves(page, original);
  await expect(saved(page)).toContainText('TOM saved over the written results');
  await expect(page.getByRole('button', { name: 'Write 2 results to .tdf' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Link .tdf file' })).toBeVisible();
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
  await expect(saved(page)).toContainText('Saved by TOM');
  const file = await tomFile(page);
  await expect(file).toContainText('Following');
  await expect(file).toContainText('Last imported');
  const before = await file.locator('.tm-file-line').innerText();
  await page.clock.fastForward(10_000);
  expect(await file.locator('.tm-file-line').innerText()).toBe(before);
  expect(syncs).toBe(1);
  await file
    .locator('input[type="file"]')
    .setInputFiles({ name: 'manual.tdf', mimeType: 'text/xml', buffer: Buffer.from(TDF_SOURCE) });
  await expect(file).toContainText('Not linked');
  await expect(page.getByRole('button', { name: 'Link .tdf file' })).toBeVisible();
  await expect(file.getByRole('button', { name: 'Refresh .tdf' })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Upload .tdf' })).toBeVisible();
  const file = await tomFile(page);
  await expect(file).toContainText('Not linked');
  await expect(file).toContainText('This browser cannot follow files');
  await expect(page.getByRole('button', { name: 'Link .tdf file' })).toHaveCount(0);
  const before = await file.locator('.tm-file-line').innerText();
  await page
    .locator('.tm-tom-status input[type="file"]')
    .setInputFiles({ name: 'manual.tdf', mimeType: 'text/xml', buffer: Buffer.from(TDF_SOURCE) });
  await expect(file.locator('.tm-file-line')).not.toHaveText(before);
  await expect(file).toContainText('Not linked');
});

test('a failed manual upload preserves automatic TOM following', async ({ page }) => {
  let syncs = 0;
  await tomConsole(page, () => {
    syncs += 1;
    return synced();
  });
  await expect(saved(page)).toContainText('Saved by TOM');
  const file = await tomFile(page);
  await expect(file).toContainText('Following');
  await file
    .locator('input[type="file"]')
    .setInputFiles({ name: 'broken.tdf', mimeType: 'text/xml', buffer: Buffer.from('<broken>') });
  await expect(page.getByText('Could not parse the .tdf')).toBeVisible();
  await expect(file).toContainText('Following');
  expect(syncs).toBe(1);
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('Fixture Challenge', 'Updated Challenge');
    file.modified += 1;
  });
  await file.getByRole('button', { name: 'Refresh .tdf' }).click();
  await expect.poll(() => syncs).toBe(2);
  await expect(page.getByText('Could not parse the .tdf')).toHaveCount(0);
});

for (const size of [
  { width: 320, height: 480 },
  { width: 750, height: 342 }
]) {
  test(`player sheet keeps identity and actions in view at ${size.width}x${size.height} @mobile`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApi(page);
    await page.goto(`/t/${CODE}`);
    await page
      .locator('.tm-matches')
      .getByRole('button', { name: /Hedy Lamarr/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const geometry = await sheet.evaluate(el => {
      const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
      const head = rect('.tm-sheet-head');
      const foot = rect('.tm-sheet-foot');
      const stats = [...el.querySelectorAll('.tm-sheet-stats dd')].map(dd => ({
        value: dd.getBoundingClientRect().right,
        cell: dd.parentElement!.getBoundingClientRect().right
      }));
      return { top: head.top, bottom: foot.bottom, height: window.innerHeight, stats };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.stats.every(stat => stat.value <= stat.cell)).toBe(true);
    await sheet.getByRole('button', { name: 'This is me', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'This is me', exact: true })).toBeVisible();
  });
}

function phoneLookupEvent() {
  let tournament = emptyTournament({ name: 'Phone Lookup' });
  const players = Array.from({ length: 64 }, (_, index) => ({
    firstName: index === 0 ? 'Peter' : index === 1 ? 'Patricia' : `Player${index}`,
    lastName: index < 2 ? 'Parker' : `Surname${index}`
  }));
  const commands = [
    ...players.map(player => ({ type: 'addPlayer' as const, player })),
    { type: 'pairRound' as const, pod: 'masters' as const }
  ];
  for (const command of commands) {
    const result = applyCommand(tournament, command, {
      now: 0,
      localTime: '10/10/2026 12:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    ({ tournament } = result);
  }
  const publicKeys = assignKeys(tournament, {});
  const view: TournamentView = {
    ...VIEW,
    mode: 'swiss',
    tournament: publicTournament(tournament, publicKeys, true),
    settings: { ...DEFAULT_SETTINGS, sanctioned: false, playerReporting: false },
    divisions: publicDivisions(tournament, publicKeys, Date.now()),
    decks: {}
  };
  return { tournament, publicKeys, view };
}

for (const denied of ['local', 'both'] as const) {
  test(`64-player phone lookup confirms candidates with reporting off and ${denied} storage denied @mobile`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(blocked => {
      for (const key of blocked === 'both' ? ['localStorage', 'sessionStorage'] : ['localStorage']) {
        Object.defineProperty(window, key, {
          configurable: true,
          get() {
            throw new DOMException('Denied', 'SecurityError');
          }
        });
      }
    }, denied);
    const { tournament, publicKeys, view } = phoneLookupEvent();
    const errors = await mockApi(page, view);
    await publish(page, () => view);
    const requests: Record<string, unknown>[] = [];
    await page.route(`**/api/tournaments/${CODE}/report`, route => {
      const body = route.request().postDataJSON() as { lookup?: boolean; lastName: string; firstName?: string };
      requests.push(body);
      expect(body.lookup, 'lookup must not claim a seat').toBe(true);
      const candidates = lookupPlayers(tournament.players, body).map(player => {
        const shown = view.tournament.players.find(published => published.id === publicKeys[player.id])!;
        return { key: shown.id, firstName: shown.firstName, lastName: shown.lastName };
      });
      return route.fulfill({ json: { candidates, view } });
    });
    await page.goto(`/t/${CODE}`);
    await page.getByLabel('Last name', { exact: true }).fill('Perker');
    await page.getByRole('button', { name: 'Find my match' }).click();
    await expect(page.getByRole('button', { name: 'Show table' })).toHaveCount(2);
    // The count and the need for a first name are announced, and each choice is named for its player and table.
    const status = page.getByRole('status').filter({ hasText: 'matching player' });
    await expect(status).toHaveText('2 matching players. Add a first name to narrow the list.');
    const choices = page.getByRole('group', { name: 'Choose your player' }).getByRole('button');
    await expect(choices.filter({ hasText: 'Show table' })).toHaveCount(2);
    await expect(
      choices.and(page.getByRole('button', { name: /^Show table for Peter P\., Masters, Table \d+$/ }))
    ).toHaveCount(1);
    await expect(
      choices.and(page.getByRole('button', { name: /^Show table for Patricia P\., Masters, Table \d+$/ }))
    ).toHaveCount(1);
    await expect(page.locator('.tm-you-who')).toHaveCount(0);
    await page.getByLabel('First name', { exact: true }).fill('Piter');
    await page.getByRole('button', { name: 'Find my match' }).click();
    await expect(page.getByRole('button', { name: 'Show table' })).toHaveCount(1);
    await expect(status).toHaveText('1 matching player');
    await expect(page.locator('.tm-lookup-match')).toContainText('Peter P.');
    await expect(page.locator('.tm-you-who')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show table' }).click();
    await expect(page.locator('.tm-you-big')).toContainText('Table');
    await expect(page.locator('.tm-you-who')).toContainText('Peter P.');
    await expect(page.getByRole('button', { name: 'Report result' })).toHaveCount(0);
    if (denied === 'local') {
      await page.reload();
      await expect(page.locator('.tm-you-who')).toContainText('Peter P.');
      expect(requests).toHaveLength(2);
    }
    expect(errors).toEqual([]);
  });
}

test('a remembered lookup keeps its target when reporting is confirmed beside another signed-in player', async ({
  page
}) => {
  const accountPlayer = tdf.players.find(player => player.lastName === 'Jackson')!;
  const selectedPlayer = tdf.players.find(player => player.lastName === 'Perlman')!;
  const accountKey = keys[accountPlayer.id]!;
  const selectedKey = keys[selectedPlayer.id]!;
  const view: TournamentView = {
    ...VIEW,
    settings: { ...VIEW.settings, playerReporting: true },
    viewer: {
      role: null,
      me: accountKey,
      via: 'pop',
      signedIn: true,
      claim: { popId: accountPlayer.id, birthYear: yearOf('Jackson') }
    }
  };
  await mockApi(page, view);
  await page.addInitScript(({ code, key }) => sessionStorage.setItem(`cm-tournament-me:${code}`, key), {
    code: CODE,
    key: selectedKey
  });
  const reports: { popId?: string; reportToken?: string; result?: string }[] = [];
  await page.route(`**/api/tournaments/${CODE}/report`, route => {
    const body = route.request().postDataJSON() as (typeof reports)[number];
    const selected = body.popId === selectedPlayer.id;
    if (body.result) {
      reports.push(body);
    }
    return route.fulfill({
      json: {
        key: selected ? selectedKey : accountKey,
        view,
        reporter: true,
        linked: !selected,
        ...(selected ? { reportToken: 'selected-token' } : {})
      }
    });
  });
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-you-who')).toContainText('Radia Perlman');
  await page.getByRole('button', { name: 'Report result' }).click();
  // The claim form replaces Report result, and Cancel backs out of it.
  await expect(page.getByRole('button', { name: 'Report result' })).toHaveCount(0);
  await page.locator('.tm-you-panel').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm reporting player' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Report result' }).click();
  await page.getByLabel('Player ID', { exact: true }).fill(selectedPlayer.id);
  await page.getByLabel('Birth year', { exact: true }).fill(yearOf('Perlman'));
  await page.getByRole('button', { name: 'Confirm reporting player' }).click();
  await expect(page.locator('.tm-you-who')).toContainText('Radia Perlman');
  await page.getByRole('button', { name: 'I won', exact: true }).click();
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ popId: selectedPlayer.id, reportToken: 'selected-token', result: 'win' });
});

test('setup asks when, starting in the store’s zone, and keeps the answers; the store is where', async ({ page }) => {
  const submissions = await mockOrganizer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  await expect(zone).toHaveValue('America/Chicago');
  await expect(page.getByRole('textbox', { name: 'Venue' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Address' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Event name' }).fill('Sunday Cup');
  await page.locator('#setup-check-in').fill('2026-10-18T11:30');
  await zone.selectOption('Europe/London');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page.locator('#setup-check-in')).toHaveValue('2026-10-18T11:30');
  await expect(zone).toHaveValue('Europe/London');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.locator('.tm-error')).toHaveText('Fixture submission');
  expect(submissions).toEqual([
    expect.objectContaining({
      settings: expect.objectContaining({
        timeZone: 'Europe/London',
        venue: '',
        address: '',
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

test('a reporting player asks staff to drop them and can take it back until staff answer @mobile', async ({ page }) => {
  const view = { ...VIEW, settings: { ...VIEW.settings, playerReporting: true } };
  await mockApi(page, view);
  await publish(page, () => view);
  const mary = tdf.players.find(player => player.lastName === 'Jackson');
  const key = keys[mary?.id ?? ''] ?? '';
  const asked: { request?: string; cancel?: boolean; reportToken?: string }[] = [];
  await page.route(`**/api/tournaments/${CODE}/report`, route => {
    const body = route.request().postDataJSON() as { lookup?: boolean; device: string; request?: string };
    if (body.lookup) {
      return route.fulfill({ json: { candidates: [{ key, firstName: 'Mary', lastName: 'Jackson' }], view } });
    }
    if (body.request) {
      asked.push(body);
      const cancelled = asked.at(-1)?.cancel === true;
      const made = { id: 'request-1', player: key, kind: 'drop' as const, at: Date.now() };
      // As the server keeps it: a cancelled request stays, marked, and reads to the player as none.
      const requests = [
        cancelled
          ? { ...made, status: 'cancelled' as const, answeredAt: Date.now() }
          : { ...made, status: 'open' as const }
      ];
      return route.fulfill({ json: { key, view: { ...view, requests }, reporter: true } });
    }
    return route.fulfill({ json: { key, view, reporter: true, reportToken: 'phone-token' } });
  });
  await page.goto(`/t/${CODE}`);
  await page.getByLabel('Last name', { exact: true }).fill('Jackson');
  await page.getByRole('button', { name: 'Find my match' }).click();
  await page.getByRole('button', { name: 'Show table' }).click();
  await expect(page.getByRole('button', { name: 'Request drop' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Report result' }).click();
  await page.getByLabel('Player ID', { exact: true }).fill(mary?.id ?? '');
  await page.getByLabel('Birth year').fill(yearOf('Jackson'));
  await page.getByRole('button', { name: 'Confirm reporting player' }).click();
  await page.getByRole('button', { name: 'Request drop' }).click();
  await page.getByRole('button', { name: 'Ask staff' }).click();
  await expect(page.locator('.tm-you-requests')).toContainText('Drop requested');
  expect(asked[0]).toMatchObject({ request: 'drop', reportToken: 'phone-token' });
  await expect(page.getByRole('button', { name: 'Request drop' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByRole('button', { name: 'Request drop' })).toBeVisible();
  expect(asked[1]).toMatchObject({ request: 'drop', cancel: true });
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

test('a big screen preset picked while another saves stays picked, unsaved', async ({ page }) => {
  await tomConsole(page, () => ({ status: 200, json: tomManage() }), { following: false });
  const presets = [
    { id: 'wall', name: 'Wall TV', options: { scale: 1.5, layout: 'alphabetical', pageSeconds: 15 } },
    { id: 'gym', name: 'Gym TV', options: { scale: 1, layout: 'auto', pageSeconds: 20 } }
  ];
  const answer = deferred<void>();
  await page.route(`**/api/tournaments/${CODE}/display`, async route => {
    if (route.request().method() !== 'PUT') {
      return route.fulfill({ json: { presets, selected: null } });
    }
    await answer.promise;
    const display = { ...presets[0], storeId: 'store-1' };
    return route.fulfill({ json: { ...tomManage(), settings: { ...DEFAULT_SETTINGS, display } } });
  });
  await page.getByRole('tab', { name: 'Settings' }).click();
  const box = page.locator('section', { hasText: 'Big screen' });
  const select = page.getByLabel('Display preset');
  await expect(select.locator('option', { hasText: 'Gym TV' })).toHaveCount(1);
  await select.selectOption('wall');
  await box.getByRole('button', { name: 'Save' }).click();
  await select.selectOption('gym');
  answer.resolve();
  await expect(box.getByRole('button', { name: 'Save' })).toBeEnabled();
  await expect(select).toHaveValue('gym');
  await expect(box.getByText('Unsaved changes')).toBeVisible();
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
