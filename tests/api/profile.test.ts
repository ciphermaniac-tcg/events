import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as preferences from '../../functions/api/me/profile.ts';
import * as me from '../../functions/api/me.ts';
import * as profiles from '../../functions/api/profiles/[handle].ts';
import * as history from '../../functions/api/history.ts';
import * as data from '../../functions/api/me/data.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler, request } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, addPlayers, settle } = eventCalls(hit);
const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
const read = (cookie?: string) => hit(preferences.onRequestGet as Handler, '/api/me/profile', {}, { cookie });
const save = (cookie: string, body: unknown, origin?: string) =>
  hit(preferences.onRequestPut as Handler, '/api/me/profile', {}, { cookie, method: 'PUT', body, origin });
const publicProfile = (handle: string) => hit(profiles.onRequestGet as Handler, `/api/profiles/${handle}`, { handle });
const ownHistory = (cookie: string) => hit(history.onRequestGet as Handler, '/api/history', {}, { cookie });

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  profiles._resetRateLimitStore();
});

async function player() {
  const cookie = await signIn('Player');
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      cookie,
      method: 'PUT',
      body: {
        popId: '901',
        firstName: 'Test',
        lastName: 'Player',
        birthDate: '02/27/1990'
      }
    }
  );
  await hit(me.onRequestPatch as Handler, '/api/me', {}, { cookie, method: 'PATCH', body: { publicProfile: true } });
  return cookie;
}

async function completed(owner: string) {
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  await settle(code, owner, { finished: true });
  return code;
}

test('profile preferences require sign-in and same-origin writes, with private responses', async () => {
  assert.equal((await read()).status, 401);
  assert.equal((await save('', { links: {} })).status, 401);
  const cookie = await player();
  assert.deepEqual((await read(cookie)).json, { links: {} });
  assert.equal((await save(cookie, { links: {} }, 'https://evil.test')).status, 403);
  for (const body of [
    { links: {}, pins: [] },
    { unknown: [] },
    { links: { facebook: 'https://evil.test' } },
    { pins: ['A', 'A'] }
  ]) {
    assert.equal((await save(cookie, body)).status, 400);
  }
  const saved = await save(cookie, {
    links: { metafy: 'https://metafy.gg/@reese', ciphermaniac: 'https://ciphermaniac.com/players/45677' }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('Cache-Control'), 'no-store');
  assert.equal(saved.headers.get('Access-Control-Allow-Origin'), null);
  assert.deepEqual((await publicProfile('player')).json.links, saved.json.links);
  await hit(me.onRequestPatch as Handler, '/api/me', {}, { cookie, method: 'PATCH', body: { publicProfile: false } });
  assert.equal((await publicProfile('player')).status, 404);
  assert.deepEqual((await read(cookie)).json.links, saved.json.links);
});

test('retired pin requests are rejected and existing pins are not returned by profiles or history', async () => {
  const cookie = await player();
  db().raw.exec(
    `INSERT INTO profile_preferences (user_id, pins) SELECT id, '["CUP001"]' FROM users WHERE handle = 'player'`
  );
  assert.equal((await save(cookie, { pins: ['CUP001'] })).status, 400);
  assert.equal((await save(cookie, { pins: [] })).status, 400);
  await save(cookie, { links: { metafy: 'https://metafy.gg/@reese' } });
  assert.deepEqual((await read(cookie)).json, { links: { metafy: 'https://metafy.gg/@reese' } });
  assert.equal('pins' in (await publicProfile('player')).json, false);
  assert.equal('pins' in (await ownHistory(cookie)).json, false);
  assert.equal(db().raw.prepare('SELECT pins FROM profile_preferences').get()?.pins, '["CUP001"]');
});

test('data exports retain profile links and pins saved before pinning was retired', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const cookie = await player();
  const code = await completed(owner);
  await save(cookie, { links: { metafy: 'https://metafy.gg/@reese' } });
  db()
    .raw.prepare('UPDATE profile_preferences SET pins = ?')
    .run(JSON.stringify([code]));
  const response = await data.onRequestGet({
    request: request('/api/me/data?parts=profile,events', { cookie }),
    env,
    params: {}
  } as never);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.includes('https://metafy.gg/@reese'));
  assert.ok(text.includes('## Pinned results'));
  assert.ok(text.includes(code));
});

test('organizer activity lists actual owned and staffed events once, without unrelated store membership', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const other = await signIn('Other', 'organizer');
  const code = await completed(owner);
  const staffed = await newSwiss(other);
  await newSwiss(other);
  const { id } = db().raw.prepare("SELECT id FROM users WHERE handle = 'organizer'").get() as { id: string };
  db()
    .raw.prepare('INSERT INTO staff (code, user_id, joined_at) VALUES (?, ?, 1), (?, ?, 1)')
    .run(code, id, staffed, id);
  await hit(
    me.onRequestPatch as Handler,
    '/api/me',
    {},
    { cookie: owner, method: 'PATCH', body: { publicProfile: true } }
  );
  const profile = (await publicProfile('organizer')).json;
  assert.equal(profile.activity.length, 2);
  assert.deepEqual(profile.activity.find((entry: { code: string }) => entry.code === code).role, 'organized');
  const staff = profile.activity.find((entry: { code: string }) => entry.code === staffed);
  assert.equal(staff.role, 'staffed');
  assert.equal(staff.status, 'upcoming');
  assert.equal(staff.store.name, 'Other Games');
  assert.deepEqual((await ownHistory(owner)).json.activity, profile.activity);
  assert.deepEqual(Object.keys(profile.activity[0]).sort(), [
    'code',
    'format',
    'name',
    'role',
    'startDate',
    'startsAt',
    'status',
    'store'
  ]);
});

test('profile wipe and deletion remove preferences; event wipe clears legacy pins and retains links', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const cookie = await player();
  const code = await completed(owner);
  await save(cookie, { links: { metafy: 'https://metafy.gg/@reese' } });
  db()
    .raw.prepare('UPDATE profile_preferences SET pins = ?')
    .run(JSON.stringify([code]));
  await hit(data.onRequestPost as Handler, '/api/me/data', {}, { cookie, method: 'POST', body: { parts: ['events'] } });
  assert.deepEqual((await read(cookie)).json, { links: { metafy: 'https://metafy.gg/@reese' } });
  assert.equal(db().raw.prepare('SELECT pins FROM profile_preferences').get()?.pins, '[]');
  await hit(
    data.onRequestPost as Handler,
    '/api/me/data',
    {},
    { cookie, method: 'POST', body: { parts: ['profile'] } }
  );
  assert.deepEqual((await read(cookie)).json, { links: {} });
  await save(cookie, { links: { metafy: 'https://metafy.gg/@reese' } });
  assert.equal(
    (await hit(me.onRequestDelete as Handler, '/api/me', {}, { cookie, method: 'DELETE', body: { confirm: 'player' } }))
      .status,
    204
  );
  assert.equal(db().raw.prepare('SELECT count(*) AS n FROM profile_preferences').get()?.n, 0);
});

test('profile preferences migration is idempotent and preserves existing data', () => {
  const migration = readFileSync(
    new URL('../../config/d1/migrations/tournaments/0021-profile-preferences.sql', import.meta.url),
    'utf8'
  );
  db().raw.exec(
    'INSERT INTO profile_preferences (user_id, links) VALUES (\'test\', \'{"metafy":"https://metafy.gg/@test"}\')'
  );
  db().raw.exec(migration);
  db().raw.exec(migration);
  assert.equal(db().raw.prepare('SELECT count(*) AS n FROM profile_preferences').get()?.n, 1);
});
