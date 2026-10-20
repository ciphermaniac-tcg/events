/**
 * Where History's rows read their events: each event's public copy on R2,
 * the browser's cache allowed only for a finished event, and the API when
 * the edge has no copy. A copy with no player under the entry's key is no
 * entry at all. A finished row is kept on the device under its event's
 * version, and read again only once the event changes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import type { HistoryEntry } from '../../shared/accounts/types.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type PublishedView
} from '../../shared/tournament/view.ts';
import { setTranslations } from '../../src/lib/i18n/translate.ts';
import { keepBrowserMemory, readBrowserMemory } from '../../src/lib/tournament/browserMemory.ts';
import { loadEntry } from '../../src/lib/tournament/historyCopies.ts';

const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const keys = assignKeys(tdf, {});
const VIEW: PublishedView = {
  code: 'ABCDEF',
  mode: 'tom',
  version: 4,
  updatedAt: 0,
  tournament: publicTournament(tdf, keys),
  pending: [],
  reports: [],
  divisions: publicDivisions(tdf, keys, Date.UTC(2026, 9, 3)),
  decks: publicDecks({ '7200001': 'Gardevoir ex' }, keys),
  settings: { ...DEFAULT_SETTINGS, deckVisibility: 'always' }
};
const MARY = keys['7200001'] ?? '';

let codes = 0;
/** A code no earlier test has kept a row under. */
const fresh = () => `T${(codes += 1).toString().padStart(5, '0')}`;

const entry = (status: HistoryEntry['status'], key = MARY, code = 'ABCDEF', version = 4): HistoryEntry => ({
  code,
  key,
  name: 'Fixture Challenge & Friends',
  startDate: '10/03/2026',
  startsAt: '',
  format: 'Standard',
  mode: 'tom',
  status,
  version
});

const realFetch = globalThis.fetch;
let asked: { url: string; cache: RequestCache | undefined }[] = [];

/** The edge answers with `edge` (404 when null), and the API with `api`. */
function serve(edge: PublishedView | null, api: unknown = { ...VIEW, viewer: {} }) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    asked.push({ url, cache: init.cache });
    const code = /\/tournaments\/v1\/(\w+)\.json$/.exec(url)?.[1];
    if (code) {
      return edge ? Response.json({ ...edge, code }) : new Response('missing', { status: 404 });
    }
    return Response.json(api);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  asked = [];
});

test('a finished event’s copy may come from the browser’s cache; a live one is asked of the edge', async () => {
  serve(VIEW);
  const finished = await loadEntry(entry('finished'));
  assert.equal(finished?.finish.place, 1);
  assert.equal(finished?.finish.deck, 'Gardevoir ex');
  assert.equal(finished?.names.get(keys['7200002'] ?? ''), 'Dorothy Vaughan');
  await loadEntry(entry('live'));
  await loadEntry(entry('upcoming'));
  assert.deepEqual(
    asked.map(a => a.cache),
    ['default', 'no-cache', 'no-cache']
  );
});

test('with no copy on the edge, the event comes from the API', async () => {
  serve(null);
  const result = await loadEntry(entry('live'));
  assert.equal(result?.finish.place, 1);
  assert.deepEqual(
    asked.map(a => a.url.replace(/^https?:\/\/[^/]+/, '')),
    ['/tournaments/v1/ABCDEF.json', '/api/tournaments/ABCDEF']
  );
});

test('a copy with no player under the key is no entry', async () => {
  serve(VIEW);
  assert.equal(await loadEntry(entry('finished', '999', fresh())), null);
});

test('a finished row read once is not asked for again while its event stays at that version', async () => {
  serve(VIEW);
  const code = fresh();
  const first = await loadEntry(entry('finished', MARY, code));
  const again = await loadEntry(entry('finished', MARY, code));
  assert.equal(asked.length, 1);
  assert.deepEqual(again?.finish, first?.finish);
  assert.equal(again?.names.get(keys['7200002'] ?? ''), 'Dorothy Vaughan');
  assert.equal(again?.decks[MARY], 'Gardevoir ex');
});

test('another player’s row at the same event is kept apart', async () => {
  serve(VIEW);
  const code = fresh();
  const other = keys['7200002'] ?? '';
  await loadEntry(entry('finished', MARY, code));
  const theirs = await loadEntry(entry('finished', other, code));
  const mine = await loadEntry(entry('finished', MARY, code));
  assert.equal(asked.length, 2);
  assert.equal(theirs?.finish.deck, null);
  assert.equal(mine?.finish.deck, 'Gardevoir ex');
});

test('a row kept in one language is read again in another', async () => {
  serve(VIEW);
  const code = fresh();
  await loadEntry(entry('finished', MARY, code));
  setTranslations('de', {});
  try {
    await loadEntry(entry('finished', MARY, code));
  } finally {
    setTranslations('en', {});
  }
  assert.equal(asked.length, 2);
});

test('a kept row that does not parse is read again', async () => {
  serve(VIEW);
  const code = fresh();
  keepBrowserMemory(`cm-history-row:${code}:${MARY}`, '{not json', true);
  assert.equal((await loadEntry(entry('finished', MARY, code)))?.finish.deck, 'Gardevoir ex');
  assert.equal(asked.length, 1);
});

test('a corrected event is read again', async () => {
  serve(VIEW);
  const code = fresh();
  await loadEntry(entry('finished', MARY, code, 4));
  serve({ ...VIEW, version: 5, decks: { [MARY]: 'Dragapult ex' } });
  const corrected = await loadEntry(entry('finished', MARY, code, 5));
  assert.equal(asked.length, 2);
  assert.equal(corrected?.finish.deck, 'Dragapult ex');
});

test('a copy older than History says the event is goes unkept', async () => {
  serve(VIEW);
  const code = fresh();
  await loadEntry(entry('finished', MARY, code, 6));
  await loadEntry(entry('finished', MARY, code, 6));
  assert.equal(asked.length, 2);
});

test('a live or upcoming row is never kept', async () => {
  serve(VIEW);
  const code = fresh();
  await loadEntry(entry('live', MARY, code));
  await loadEntry(entry('live', MARY, code));
  await loadEntry(entry('upcoming', MARY, code));
  assert.equal(asked.length, 3);
  assert.equal(readBrowserMemory(`cm-history-row:${code}:${MARY}`, true), null);
});

test('a kept row holds only the player and their opponents', async () => {
  serve(VIEW);
  const code = fresh();
  const result = await loadEntry(entry('finished', MARY, code));
  const kept = JSON.parse(readBrowserMemory(`cm-history-row:${code}:${MARY}`, true) ?? '{}') as {
    names: [string, string][];
  };
  const opponents = (result?.finish.rounds ?? []).flatMap(row => (row.opponent ? [row.opponent] : []));
  assert.deepEqual(kept.names.map(([id]) => id).sort(), [...new Set([MARY, ...opponents])].sort());
  assert.ok(kept.names.length < VIEW.tournament.players.length);
});

test('the device keeps the newest 200 rows', async () => {
  serve(VIEW);
  const kept = Array.from({ length: 201 }, fresh);
  await Promise.all(kept.map(code => loadEntry(entry('finished', MARY, code))));
  const index = JSON.parse(readBrowserMemory('cm-history-rows', true) ?? '[]') as string[];
  assert.equal(index.length, 200);
  assert.equal(readBrowserMemory(`cm-history-row:${kept[0] ?? ''}:${MARY}`, true), null);
  assert.notEqual(readBrowserMemory(`cm-history-row:${kept[200] ?? ''}:${MARY}`, true), null);
});
