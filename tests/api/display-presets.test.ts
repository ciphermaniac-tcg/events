import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as displays from '../../functions/api/stores/[id]/displays.ts';
import * as eventDisplay from '../../functions/api/tournaments/[code]/display.ts';
import * as eventSettings from '../../functions/api/tournaments/[code]/settings.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import { MAX_DISPLAY_PRESETS } from '../../shared/tournament/display.ts';
import { apiSuite, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

const { env, hit, signIn } = apiSuite();
const { newEvent, storeOf } = eventCalls(hit);
const OPTIONS = { scale: 1.25, layout: 'alphabetical', pageSeconds: 15 };
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;
const put = (store: string, cookie: string, body: unknown) =>
  hit(displays.onRequestPut as Handler, '/displays', { id: store }, { method: 'PUT', cookie, body });

async function storeSetup() {
  const manager = await signIn('Manager', 'organizer');
  const store = (await storeOf(manager))!;
  const staff = await signIn('Staff');
  raw().prepare("INSERT INTO store_members SELECT ?, id, 'staff', 1 FROM users WHERE handle = 'staff'").run(store);
  return { manager, store, staff };
}

test('only store managers edit presets; staff can list them, and outsiders cannot read them', async () => {
  const { manager, store, staff } = await storeSetup();
  const made = await put(store, manager, { name: 'TV', options: OPTIONS });
  assert.equal(made.status, 200);
  const { preset } = made.json;
  assert.equal((await put(store, staff, { name: 'Other', options: OPTIONS })).status, 403);
  const list = (cookie?: string) => hit(displays.onRequestGet as Handler, '/displays', { id: store }, { cookie });
  assert.deepEqual((await list(staff)).json.presets, [preset]);
  assert.equal((await list()).status, 401);
  assert.equal((await list(await signIn('Outsider'))).status, 403);
  assert.equal((await put(store, manager, { name: 'tv', options: OPTIONS })).status, 409);
  assert.equal(
    (await put(store, manager, { id: preset.id, name: 'Wall TV', options: { ...OPTIONS, scale: 1.5 } })).status,
    200
  );
  const removed = await hit(
    displays.onRequestDelete as Handler,
    `/displays?preset=${preset.id}`,
    { id: store },
    { method: 'DELETE', cookie: manager }
  );
  assert.equal(removed.status, 200);
  assert.deepEqual((await list(staff)).json.presets, []);
});

const settingsOf = (code: string) =>
  JSON.parse(
    (raw().prepare('SELECT settings FROM tournaments WHERE code = ?').get(code) as { settings: string }).settings
  );
const headOf = (code: string) =>
  raw().prepare('SELECT version, updated_at FROM tournaments WHERE code = ?').get(code) as {
    version: number;
    updated_at: number;
  };

test('events select only their own store presets, follow its edits while running, and keep a copy once deleted', async () => {
  const { manager, store, staff } = await storeSetup();
  const made = await put(store, manager, { name: 'Wall TV', options: OPTIONS });
  const { preset } = made.json;
  const code = await newEvent(manager, { store });
  const second = await newEvent(manager, { store });
  const select = (event: string, value: unknown, cookie = staff) =>
    hit(eventDisplay.onRequestPut as Handler, '/display', at(event), {
      method: 'PUT',
      cookie,
      body: { preset: value }
    });
  assert.equal((await select(code, preset.id)).status, 200);
  assert.equal((await select(second, preset.id)).status, 200);
  assert.equal((await select(code, 'missing')).status, 400);
  const other = await signIn('Other', 'organizer');
  const otherEvent = await newEvent(other, { store: (await storeOf(other))! });
  assert.equal((await select(otherEvent, preset.id, other)).status, 400);
  // An ended event keeps the screen it ended with.
  raw()
    .prepare("UPDATE tournaments SET settings = json_set(settings, '$.finished', json('true')) WHERE code = ?")
    .run(second);
  const before = headOf(code);
  const edited = { id: preset.id, name: 'Changed', options: { ...OPTIONS, layout: 'faceoff', scale: 2 } };
  assert.equal((await put(store, manager, edited)).status, 200);
  const selected = { ...edited, storeId: store };
  assert.deepEqual(settingsOf(code).display, selected);
  assert.deepEqual(settingsOf(second).display, { ...preset, storeId: store });
  // A new version for the screen's poll to find, but no activity of the event's own: its idle clock runs on.
  assert.equal(headOf(code).version, before.version + 1);
  assert.equal(headOf(code).updated_at, before.updated_at);
  // Saving it unchanged writes nothing to the event.
  await put(store, manager, edited);
  assert.equal(headOf(code).version, before.version + 1);
  await hit(
    displays.onRequestDelete as Handler,
    `/displays?preset=${preset.id}`,
    { id: store },
    { method: 'DELETE', cookie: manager }
  );
  const shown = await hit(eventDisplay.onRequestGet as Handler, '/display', at(code), { cookie: staff });
  assert.deepEqual(shown.json.selected, selected);
  assert.deepEqual(shown.json.presets, []);
  assert.equal((await select(code, null)).status, 200);
  assert.equal(settingsOf(code).display, null);
  assert.equal((await select(code, preset.id, await signIn('Visitor'))).status, 403);
});

test('preset input and store limits are bounded; expired manager authorization is checked at the write', async () => {
  const { manager, store } = await storeSetup();
  for (const scale of [0, -1, 3, '1', null]) {
    assert.equal((await put(store, manager, { name: 'Invalid', options: { ...OPTIONS, scale } })).status, 400);
  }
  assert.equal((await put(store, manager, { name: '', options: OPTIONS })).status, 400);
  for (let i = 0; i < MAX_DISPLAY_PRESETS; i += 1) {
    assert.equal((await put(store, manager, { name: `TV ${i}`, options: OPTIONS })).status, 200);
  }
  assert.equal((await put(store, manager, { name: 'Too many', options: OPTIONS })).status, 409);
  raw().prepare('DELETE FROM display_presets').run();
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO display_presets', () => {
    db.raw.prepare("UPDATE store_members SET role = 'staff' WHERE store_id = ?").run(store);
  });
  assert.equal((await put(store, manager, { name: 'Delayed', options: OPTIONS })).status, 409);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM display_presets').get()?.n, 0);
});

test("settings changes and new events cannot carry a display copy; only a preset of the event's own store can", async () => {
  const { manager, store, staff } = await storeSetup();
  const code = await newEvent(manager, { store });
  const forged = { id: 'missing', name: 'Forged', storeId: 'elsewhere', options: OPTIONS };
  const changed = await hit(eventSettings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: staff,
    body: { display: forged }
  });
  assert.equal(changed.status, 400);
  assert.equal(
    (
      await hit(eventSettings.onRequestPut as Handler, '/settings', at(code), {
        method: 'PUT',
        cookie: staff,
        body: { display: null }
      })
    ).status,
    400
  );
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie: manager,
      body: { mode: 'swiss', name: 'Forged Cup', roundTime: 30, store, settings: { display: forged } }
    }
  );
  assert.equal(created.status, 400);
  assert.equal(settingsOf(code).display ?? null, null);
});
