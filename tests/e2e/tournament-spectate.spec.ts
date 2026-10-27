/**
 * Spectating against mocked functions: the public page narrows its pairings
 * to the tables still playing, to one deck, or to the players this device
 * follows, and a stream overlay shows one table on a transparent page. The
 * data is the hand-written mid-event .tdf fixture, run through the same
 * public-view code the function uses.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';

import { parseTdf } from '../../shared/tournament/tdf';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type TournamentView
} from '../../shared/tournament/view';

const CODE = 'WATCHR';
const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const keys = assignKeys(tdf, {});
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
  settings: { ...DEFAULT_SETTINGS, deckVisibility: 'always' },
  viewer: { role: null, me: null, via: null, signedIn: false }
};
const round = VIEW.tournament.pods[0]?.rounds.at(-1);
const matches = round?.matches ?? [];
const playing = matches.filter(m => m.p2 !== null && m.outcome === 'pending');

async function mockApi(page: Page, view: TournamentView = VIEW) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
  });
}

const NOW = Date.UTC(2026, 9, 3, 16);

/** The round a minute past its time at NOW, every table with two players given five minutes more. */
function extendedView(): TournamentView {
  const pod = VIEW.tournament.pods[0]!;
  const latest = pod.rounds.at(-1)!;
  const extended = {
    ...latest,
    status: 'started' as const,
    startTime: '10/03/2026 15:00:00',
    clockStartedAt: NOW - 120_000,
    timeLeft: 60,
    matches: latest.matches.map(m => (m.p2 ? { ...m, timeExtension: { seconds: 300, reason: '' } } : m))
  };
  return {
    ...VIEW,
    tournament: { ...VIEW.tournament, pods: [{ ...pod, rounds: [...pod.rounds.slice(0, -1), extended] }] }
  };
}

test('a cold event load resolves named archetype icons without opening a deck picker @mobile', async ({ page }) => {
  await mockApi(page);
  await page.route('**/archetype-icons.json', route =>
    route.fulfill({ json: { 'Gardevoir ex': ['gardevoir', 'kirlia'] } })
  );
  await page.route('**/pokemon-sprites/gen9/*.png', route =>
    route.fulfill({
      contentType: 'image/png',
      body: readFileSync(new URL('../../static/img/substitute.png', import.meta.url))
    })
  );
  await page.goto(`/t/${CODE}`);
  const deck = page.locator('.tm-deck[title="Gardevoir ex"]').first();
  await expect(deck.locator('img')).toHaveCount(2);
  await expect(deck.locator('img').first()).toHaveAttribute('src', /\/gardevoir\.png$/);
  await expect(deck.locator('img').last()).toHaveAttribute('src', /\/kirlia\.png$/);
});

test('a deck the icon map doesn’t know stands as the Substitute doll, not as no deck', async ({ page }) => {
  const decks = publicDecks(
    { '7200001': 'Gardevoir ex', [tdf.players.find(player => player.id !== '7200001')?.id ?? '']: 'Rogue Brew' },
    keys
  );
  await mockApi(page, { ...VIEW, decks });
  await page.route('**/archetype-icons.json', route =>
    route.fulfill({ json: { 'Gardevoir ex': ['gardevoir', 'kirlia'] } })
  );
  await page.goto(`/t/${CODE}`);
  const rogue = page.locator('.tm-deck[title="Rogue Brew"]').first();
  await expect(rogue.locator('img')).toHaveAttribute('src', '/img/substitute.png');
  // A player who reported nothing still shows no icon.
  await expect(page.locator('.tm-matches .tm-deck')).toHaveCount(2);
});

test('the player sheet dims the page in dark mode too, and floats over it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  await page.locator('.tm-matches .tm-seat-link').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // One scrim for every modal layer: black at 45%, never the page's own pale ink.
  expect(await page.locator('.tm-scrim').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0.45)'
  );
  expect(await page.locator('.tm-sheet').evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
});

test('a spectator narrows the pairings to the tables playing, one deck, or the players they follow @mobile', async ({
  page
}) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  await expect(rows).toHaveCount(matches.length);
  // The tables still playing lead under their own heading, on a phone too.
  const groups = page.locator('.tm-matches .tm-group-row');
  await expect(groups).toHaveText([`In progress · ${playing.length}`, `Done · ${matches.length - playing.length}`]);
  // Each heading spans its table, on a phone as on a desktop.
  const width = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate(el => el.getBoundingClientRect().width);
  expect(await width('.tm-matches .tm-group-row th')).toBe(await width('.tm-matches tbody'));
  if (test.info().project.name === 'mobile') {
    // A phone has the heading in place of In progress, and the deck filter on a row of its own.
    await expect(page.getByRole('radio', { name: 'In progress' })).toBeHidden();
    await page.getByRole('combobox', { name: 'Deck' }).selectOption('Gardevoir ex');
    await expect(rows).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Deck' }).selectOption('');
  } else {
    await page.getByRole('radio', { name: 'In progress' }).click();
    await expect(rows).toHaveCount(playing.length);
    await page.getByRole('radio', { name: 'All', exact: true }).click();
    await page.getByRole('combobox', { name: 'Deck' }).selectOption('Gardevoir ex');
    await expect(rows).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Deck' }).selectOption('');
    await expect(rows).toHaveCount(matches.length);
  }

  await expect(page.getByRole('radio', { name: /^Following/ })).toHaveCount(0);
  await rows.last().getByRole('button').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Follow' }).click();
  await expect(sheet.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: 'Following 1' }).click();
  await expect(rows).toHaveCount(1);
  // A search that leaves no tables says so instead of leaving a bare head.
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('Nobody by this name');
  await expect(rows).toHaveText(['No tables match.']);
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Following 1' })).toBeVisible();
});

test('a stream overlay shows one table on a transparent page, and says when it is not in play', async ({ page }) => {
  await mockApi(page);
  const [first] = playing;
  await page.goto(`/t/${CODE}?stream=table&table=${first?.table ?? 1}`);
  const bar = page.locator('.tm-stream-bar');
  await expect(bar.locator('.tm-stream-seat')).toHaveCount(2);
  await expect(bar).toContainText(`Table ${first?.table ?? 1}`);
  await expect(page.locator('.topnav')).toBeHidden();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgba(0, 0, 0, 0)');
  await page.goto(`/t/${CODE}?stream=table&table=99`);
  await expect(page.locator('.tm-stream-bar')).toHaveText('Table 99 is not in play');
});

test('the stream counts its table’s extra time, and its clock stops once the table has a result', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await mockApi(page, extendedView());
  const [open] = playing;
  await page.goto(`/t/${CODE}?stream=table&table=${open?.table ?? 1}`);
  const clock = page.locator('.tm-stream-clock');
  // A minute over the round, with five minutes more: about four left at the table, not time called.
  await expect(clock).toHaveText(/^[34]:\d\d$/);
  await expect(clock).not.toHaveClass(/is-over/);
  await expect(page.locator('.tm-stream-mid')).toContainText('+5 min');
  const decided = matches.find(m => m.p2 !== null && m.outcome !== 'pending');
  await page.goto(`/t/${CODE}?stream=table&table=${decided?.table ?? 1}`);
  await expect(page.locator('.tm-stream-mark')).toHaveCount(2);
  await expect(clock).toHaveCount(0);
});

test('the big screen marks the tables on extra time once the round’s time is out', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install({ time: NOW });
  await mockApi(page, extendedView());
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.tm-screen-mid .tm-screen-extra')).toHaveCount(playing.length);
  await expect(page.locator('.tm-screen-mid .tm-screen-extra').first()).toHaveText('+5 min');
  // Time is called in words, not by a minus sign: the face says so, the caption says when.
  await expect(page.locator('.tm-screen-big-clock').getByRole('timer')).toHaveText('Time');
  await expect(page.locator('.tm-screen-big-clock p')).toHaveText(
    new RegExp(`^Called 1:\\d\\d ago · ${playing.length} tables on extra time$`)
  );
});

test('a paused stream clock says so in words', async ({ page }) => {
  const view = extendedView();
  const latest = view.tournament.pods[0]!.rounds.at(-1)!;
  Object.assign(latest, { clockStartedAt: null, timeLeft: 725 });
  await mockApi(page, view);
  await page.goto(`/t/${CODE}?stream=table&table=${playing[0]?.table ?? 1}`);
  await expect(page.locator('.tm-stream-clock')).toHaveText('Paused · 17:05');
});

test('mid-round the hero leaves out when the event last changed, which the clock already answers', async ({ page }) => {
  const updatedAt = Date.UTC(2026, 9, 3, 15, 41);
  await mockApi(page, { ...VIEW, updatedAt });
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-public .tm-status')).toBeVisible();
  await expect(page.getByText(/^Updated /)).toHaveCount(0);
  const pod = VIEW.tournament.pods[0]!;
  const latest = pod.rounds.at(-1)!;
  const decided = { ...latest, matches: latest.matches.map(m => (m.p2 ? { ...m, outcome: 'p1' as const } : m)) };
  await page.unroute('**/api/**');
  await mockApi(page, {
    ...VIEW,
    updatedAt,
    tournament: { ...VIEW.tournament, pods: [{ ...pod, rounds: [...pod.rounds.slice(0, -1), decided] }] }
  });
  await page.reload();
  await expect(page.getByText(/^Updated /)).toHaveCount(1);
});

test('In progress, once every table has a result, says so instead of leaving a bare head', async ({ page }) => {
  const pod = VIEW.tournament.pods[0]!;
  const latest = pod.rounds.at(-1)!;
  const decided = { ...latest, matches: latest.matches.map(m => (m.p2 ? { ...m, outcome: 'p1' as const } : m)) };
  await mockApi(page, {
    ...VIEW,
    tournament: { ...VIEW.tournament, pods: [{ ...pod, rounds: [...pod.rounds.slice(0, -1), decided] }] }
  });
  await page.goto(`/t/${CODE}`);
  await page.getByRole('radio', { name: 'In progress' }).click();
  await expect(page.locator('.tm-matches tbody tr')).toHaveText(['Every table has a result.']);
});

test('In progress with a search that finds nobody says no tables match, not that every table has a result', async ({
  page
}) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  await page.getByRole('radio', { name: 'In progress' }).click();
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('Nobody by this name');
  await expect(page.locator('.tm-matches tbody tr')).toHaveText(['No tables match.']);
});

test('a stream bar is sized for a broadcast inside title-safe, and a producer can scale it', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockApi(page);
  const table = playing[0]?.table ?? 1;
  await page.goto(`/t/${CODE}?stream=table&table=${table}`);
  const size = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await expect(page.locator('.tm-stream-bar')).toBeVisible();
  expect(await size('.tm-stream-name')).toBe(40);
  expect(await size('.tm-stream-detail')).toBe(24);
  expect(await size('.tm-stream-round')).toBe(24);
  const bottom = await page.locator('.tm-stream').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
  expect(bottom).toBeGreaterThanOrEqual(54);
  await page.goto(`/t/${CODE}?stream=table&table=${table}&scale=1.5`);
  await expect(page.locator('.tm-stream-bar')).toBeVisible();
  expect(await size('.tm-stream-name')).toBe(60);
});

/** The font size of every visible text field on the page, which iOS zooms into below 16px. */
const fieldSizes = (page: Page) =>
  page
    .locator('main :is(input:not([type=checkbox], [type=radio]), select, textarea):visible')
    .evaluateAll(fields => fields.map(field => getComputedStyle(field).fontSize));

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('fields stay at 16px, so focusing one doesn’t zoom the page', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/t/${CODE}`);
    await expect(page.locator('.tm-matches tbody tr').first()).toBeVisible();
    const sizes = await fieldSizes(page);
    expect(sizes.length).toBeGreaterThan(0);
    expect(new Set(sizes)).toEqual(new Set(['16px']));
  });
});

test('a player picking the latest round again follows the next one when it posts', async ({ page }) => {
  const pod = VIEW.tournament.pods[0]!;
  const latest = pod.rounds.at(-1)!;
  const next = {
    ...latest,
    number: latest.number + 1,
    matches: latest.matches.map(m => ({ ...m, outcome: 'pending' as const }))
  };
  let view = VIEW;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return route.fulfill({ json: view });
  });
  await page.goto(`/t/${CODE}`);
  const picker = page.getByRole('combobox', { name: 'Round', exact: true });
  await expect(picker).toHaveValue(String(latest.number));
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(picker).toHaveValue(String(latest.number - 1));
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(picker).toHaveValue(String(latest.number));
  view = {
    ...VIEW,
    version: VIEW.version + 1,
    tournament: { ...VIEW.tournament, pods: [{ ...pod, rounds: [...pod.rounds, next] }] }
  };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(picker).toHaveValue(String(next.number));
});

test('the standings mark the viewer’s own row, and say so when a search finds nobody', async ({ page }) => {
  const me = matches[0]!.p1;
  await mockApi(page, { ...VIEW, viewer: { role: null, me, via: 'claim', signedIn: true } });
  await page.goto(`/t/${CODE}?tab=standings`);
  await expect(page.locator('.tm-standings tr.is-me .tm-flag.is-you')).toHaveText('You');
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('nobody by this name');
  await expect(page.locator('.tm-standings .tm-empty-row')).toHaveText('No players match.');
});

test('a bye staff assigned reads as a bye in the pairings and on the player’s sheet, not as a missed round', async ({
  page
}) => {
  // P0 Master starts round 1 on an assigned bye (outcome 4).
  const earned = parseTdf(
    readFileSync(new URL('../fixtures/tdf/harness/earned-challenge/03-r1-paired.tdf', import.meta.url), 'utf8')
  );
  const earnedKeys = assignKeys(earned, {});
  await mockApi(page, {
    ...VIEW,
    tournament: publicTournament(earned, earnedKeys),
    divisions: publicDivisions(earned, earnedKeys, Date.UTC(2026, 9, 4)),
    decks: {}
  });
  await page.goto(`/t/${CODE}`);
  const row = page.locator('.tm-matches tbody tr', { hasText: 'P0 Master' });
  await expect(row).toContainText('Bye');
  await expect(row).not.toContainText('Missed round');
  await row.locator('.tm-seat-link', { hasText: 'P0 Master' }).click();
  await expect(page.getByRole('dialog')).toContainText('Bye');
  await expect(page.getByRole('dialog')).not.toContainText('Missed round');
});
