import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as players from '../../functions/api/tournaments/[code]/players.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { playerSearch } from '../../shared/tournament/returningPlayers.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let db: ReturnType<typeof sqliteD1>;
let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, send } = eventCalls(hit);
const search = (code: string, query: string, cookie?: string) =>
  hit(players.onRequestGet as Handler, `/api/tournaments/${code}/players?q=${encodeURIComponent(query)}`, at(code), {
    cookie
  });

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

const alex = { firstName: 'Alex', lastName: 'Morgan', id: '1234567', birthDate: '01/01/1998' };

test('search validation rejects empty, short and oversized names', () => {
  assert.equal(playerSearch(' a '), '');
  assert.equal(playerSearch(' '.repeat(3)), '');
  assert.equal(playerSearch('a'.repeat(101)), '');
  assert.equal(playerSearch(' Al '), 'Al');
});

test('suggests the newest prior profile, excludes current players, and keeps responses private', async () => {
  const cookie = await signIn('Organizer', 'organizer');
  const older = await newEvent(cookie);
  await send(older, cookie, { type: 'addPlayer', player: alex });
  const recent = await newEvent(cookie);
  await send(recent, cookie, { type: 'addPlayer', player: { ...alex, lastName: 'Newname', birthDate: '02/27/1999' } });
  db.raw.prepare('UPDATE tournaments SET updated_at = 1 WHERE code = ?').run(older);
  const code = await newEvent(cookie);
  const result = await search(code, 'aL', cookie);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.players, [{ firstName: 'Alex', lastName: 'Newname', popId: alex.id, birthYear: 1999 }]);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  assert.deepEqual((await search(code, 'Morgan', cookie)).json.players, []);
  await send(code, cookie, { type: 'addPlayer', player: alex });
  assert.deepEqual((await search(code, 'Alex', cookie)).json.players, []);
});

test('unsanctioned rosters suggest names without their generated player IDs', async () => {
  const cookie = await signIn('Community', 'community');
  const old = await newEvent(cookie, { settings: { sanctioned: false, startsAt: '2026-10-10T12:00' } });
  await send(old, cookie, { type: 'addPlayer', player: { firstName: 'Alex', lastName: 'Morgan' } });
  const code = await newEvent(cookie, { settings: { sanctioned: false, startsAt: '2026-10-11T12:00' } });
  assert.deepEqual((await search(code, 'Alex', cookie)).json.players, [
    { firstName: 'Alex', lastName: 'Morgan', popId: '', birthYear: null }
  ]);
  await send(code, cookie, { type: 'addPlayer', player: { firstName: 'Alex', lastName: 'Morgan' } });
  assert.deepEqual((await search(code, 'Alex', cookie)).json.players, []);
});

test('denies anonymous and unrelated accounts, missing events and unavailable storage', async () => {
  const cookie = await signIn('Organizer', 'organizer');
  const code = await newEvent(cookie);
  assert.equal((await search(code, 'Alex')).status, 401);
  assert.equal((await search(code, 'Alex', await signIn('Other'))).status, 403);
  assert.equal((await search('ABCDEF', 'Alex', cookie)).status, 404);
  env.TOURNAMENT_DB = undefined;
  assert.equal((await search(code, 'Alex', cookie)).status, 503);
});

test('a current-event invitation grants no access to other rosters; prior invitations do', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const old = await newEvent(owner);
  await send(old, owner, { type: 'addPlayer', player: alex });
  const code = await newEvent(owner);
  const invited = await signIn('Invited');
  async function join(code: string) {
    const event = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
    return hit(staff.onRequestPost as Handler, '/staff', at(code), {
      method: 'POST',
      cookie: invited,
      body: { token: event.json.staffToken }
    });
  }
  await join(code);
  assert.deepEqual((await search(code, 'Alex', invited)).json.players, []);
  await join(old);
  assert.equal((await search(code, 'Alex', invited)).json.players.length, 1);
  db.raw.prepare('DELETE FROM staff WHERE code = ?').run(old);
  assert.deepEqual((await search(code, 'Alex', invited)).json.players, []);
});

test('does not search another store or another organizer and treats wildcard input literally', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const other = await signIn('Other', 'organizer');
  const old = await newEvent(other);
  await send(old, other, { type: 'addPlayer', player: alex });
  const code = await newEvent(owner);
  assert.deepEqual((await search(code, 'Alex', owner)).json.players, []);
  assert.deepEqual((await search(code, '%%', owner)).json.players, []);
  assert.deepEqual((await search(code, 'A', owner)).json.players, []);
});

test('caps suggestions at eight distinct players', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const old = await newEvent(owner);
  for (let i = 0; i < 10; i += 1) {
    await send(old, owner, { type: 'addPlayer', player: { ...alex, id: String(500 + i), lastName: String(i) } });
  }
  const code = await newEvent(owner);
  assert.equal((await search(code, 'Alex', owner)).json.players.length, 8);
});

test('players with the same name remain distinct by Player ID', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const old = await newEvent(owner);
  await send(old, owner, { type: 'addPlayer', player: alex });
  await send(old, owner, { type: 'addPlayer', player: { ...alex, id: '7654321' } });
  const code = await newEvent(owner);
  await send(code, owner, { type: 'addPlayer', player: alex });
  const result = await search(code, 'Alex', owner);
  assert.equal(result.json.players.length, 1);
  assert.equal(result.json.players[0].popId, '7654321');
});
