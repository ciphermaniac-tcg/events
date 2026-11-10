/**
 * A player's sheet copies as an image: the renderer and its fonts load on
 * the first press, the clipboard holds a PNG, and where the clipboard refuses
 * an image the browser downloads it instead.
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

const CODE = 'SHARES';
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

/** The event page with one player's sheet open; returns the font requests made so far. */
async function openSheet(page: Page): Promise<string[]> {
  const fonts: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/fonts/inter-outlines-')) {
      fonts.push(request.url());
    }
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: VIEW });
  });
  await page.route('**/pokemon-sprites/gen9/*.png', route =>
    route.fulfill({
      contentType: 'image/png',
      body: readFileSync(new URL('../../static/img/substitute.png', import.meta.url))
    })
  );
  await page.goto(`/t/${CODE}`);
  await page.locator('.tm-matches .tm-seat-link').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return fonts;
}

/** The PNG's width and height, from its header. */
const dimensions = (bytes: number[]) => {
  const view = new DataView(new Uint8Array(bytes).buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

test('Copy image puts the player’s sheet on the clipboard as a PNG, loading its fonts only then', async ({
  page,
  context
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const fonts = await openSheet(page);
  expect(fonts, 'no font data before the press').toEqual([]);
  const button = page.getByRole('dialog').getByRole('button', { name: 'Copy image' });
  await button.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(fonts).toHaveLength(4);
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item!.getType('image/png');
    return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  });
  expect(copied.type).toBe('image/png');
  expect(copied.bytes.slice(1, 4)).toEqual([0x50, 0x4e, 0x47]);
  expect(dimensions(copied.bytes).width).toBe(880);
  expect(dimensions(copied.bytes).height).toBeGreaterThan(400);
});

test('where the clipboard refuses an image, Copy image downloads it instead', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Clipboard.prototype, 'write', {
      value: () => Promise.reject(new DOMException('Refused', 'NotAllowedError'))
    });
  });
  await openSheet(page);
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Copy image' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Fixture-Challenge-Friends-.+\.png$/);
  const bytes = Array.from(readFileSync((await file.path()) ?? ''));
  expect(dimensions(bytes).width).toBe(880);
  // A download is not a copy: the label stays as it was.
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Copy image' })).toBeVisible();
});
