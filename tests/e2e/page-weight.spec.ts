/**
 * What each page downloads: the code a visitor never uses stays off the page.
 * Chunk names are content hashes, so modules are found through the build's
 * manifest, or by a string only that module carries.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './network-guard';
import { chunkOf } from './build-manifest';

import { parseTdf } from '../../shared/tournament/tdf';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type TournamentView
} from '../../shared/tournament/view';

const DIST = new URL('../../.cache/e2e-dist/', import.meta.url);
const CODE = 'WEIGHT';
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
  decks: publicDecks({}, keys),
  settings: DEFAULT_SETTINGS,
  viewer: { role: null, me: null, via: null, signedIn: false }
};

/** A name from the past formats' archetype list, which only setup's format picker carries. */
const FORMAT_LIST = 'Dark Tyranitar';
/** What the TOM file reader says of a file that is not one, which no other module carries. */
const TDF_READER = 'Not a TOM tournament file';
const TDF_SOURCE = readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url));

async function mockEvent(page: Page, view: TournamentView = VIEW) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
  });
}

/** Every URL the page asks for. */
function requests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => urls.push(request.url()));
  return urls;
}

/** The text of every script the page has downloaded when it is asked. */
function scripts(page: Page): () => Promise<string[]> {
  const texts: Promise<string>[] = [];
  page.on('response', response => {
    if (response.url().endsWith('.js')) {
      texts.push(response.text());
    }
  });
  return () => Promise.all(texts);
}

test('the build still carries the strings the checks below look for', () => {
  const assets = new URL('assets/', DIST);
  const texts = readdirSync(assets)
    .filter(name => name.endsWith('.js'))
    .map(name => readFileSync(new URL(name, assets), 'utf8'));
  expect(texts.some(text => text.includes(FORMAT_LIST))).toBe(true);
  expect(texts.some(text => text.includes(TDF_READER))).toBe(true);
});

test('the public page leaves out the format picker’s list of past formats', async ({ page }) => {
  await mockEvent(page);
  const loaded = scripts(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-matches tbody tr:not(.tm-group-row)')).toHaveCount(4);
  const texts = await loaded();
  expect(texts.length).toBeGreaterThan(0);
  expect(texts.some(text => text.includes(FORMAT_LIST))).toBe(false);
});

test('a page whose decks the icon map names all draws them without loading every Pokémon', async ({ page }) => {
  const players = tdf.players.slice(0, 4).map(player => player.id);
  const view = {
    ...VIEW,
    decks: publicDecks(Object.fromEntries(players.map(id => [id, 'Gardevoir ex'])), keys),
    settings: { ...DEFAULT_SETTINGS, deckVisibility: 'always' as const }
  };
  await mockEvent(page, view);
  await page.route('**/archetype-icons.json', route =>
    route.fulfill({ json: { 'Gardevoir ex': ['gardevoir', 'kirlia'] } })
  );
  await page.route('**/pokemon-sprites/**', route => route.fulfill({ status: 404 }));
  const asked = requests(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-deck[title="Gardevoir ex"] img').first()).toHaveAttribute('src', /\/gardevoir\.png$/);
  const species = chunkOf('shared/pokemon/species.ts');
  expect(asked.filter(url => url.endsWith(species))).toEqual([]);
  expect(asked.filter(url => url.endsWith('/archetype-icons.json'))).toHaveLength(1);
});

test('a page that draws no deck never reads the icon map', async ({ page }) => {
  await mockEvent(page);
  const asked = requests(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-matches tbody tr:not(.tm-group-row)')).toHaveCount(4);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(asked.filter(url => url.includes('archetype-icons') || url.endsWith('/current.json'))).toEqual([]);
});

/** An organizer whose store may run events, with none yet. */
async function mockOrganizer(page: Page) {
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/me') {
      const store = { id: 'store-1', name: 'Test Games', leagueId: '1000001', status: 'active', role: 'manager' };
      return route.fulfill({
        json: { user: { id: 'organizer', name: 'Organizer', role: null, stores: [store] }, providers: [] }
      });
    }
    return route.fulfill({ json: { tournaments: [] } });
  });
  // The upload fallback, so the test supplies a file without an OS picker.
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
}

test('the home page loads the TOM file reader once a .tdf is picked, not before', async ({ page }) => {
  await mockOrganizer(page);
  const loaded = scripts(page);
  await page.goto('/');
  const file = page.locator('input[type="file"]');
  await expect(file).toBeAttached();
  expect((await loaded()).some(text => text.includes(TDF_READER))).toBe(false);
  await file.setInputFiles({ name: 'challenge.tdf', mimeType: 'text/xml', buffer: TDF_SOURCE });
  await expect(page.getByRole('button', { name: 'Create event' })).toBeVisible();
  expect((await loaded()).some(text => text.includes(TDF_READER))).toBe(true);
});

test('the signed-out home page leaves the TOM file reader out', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { user: null, providers: ['google'] } }));
  const loaded = scripts(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await loaded()).some(text => text.includes(TDF_READER))).toBe(false);
});

test('a page draws every weight it sets from the one preloaded font file', async ({ page }) => {
  await mockEvent(page);
  const asked = requests(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-matches tbody tr:not(.tm-group-row)')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  const weights = await page.evaluate(() =>
    [400, 500, 600, 700, 800].filter(weight => document.fonts.check(`${weight} 16px Inter`, 'Table'))
  );
  expect(weights).toEqual([400, 500, 600, 700, 800]);
  expect(asked.filter(url => url.endsWith('.woff2')).map(url => new URL(url).pathname)).toEqual([
    '/fonts/inter-latin-var.woff2'
  ]);
});
