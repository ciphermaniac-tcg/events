/**
 * The demo's in-browser server, run in Node: the real functions over sql.js
 * (the SQLite the browser runs) through the demo's own router, D1 adapter and
 * bucket.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import * as commands from '../../functions/api/tournaments/[code]/commands.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import * as me from '../../functions/api/me.ts';
import { sha256 } from '../../functions/lib/auth/session.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { demoBucket } from '../../demo/server/bucket.ts';
import { browserD1 } from '../../demo/server/d1.ts';
import { cookieHeader, setCookie } from '../../demo/server/cookies.ts';
import { type FunctionModule, routerFor } from '../../demo/server/routes.ts';
import { DEMO_ENTRANTS, DEMO_LISTS } from '../../demo/server/decklists.ts';
import { parseDecklist } from '../../shared/tournament/decklist.ts';

const ORIGIN = 'https://demo.test';
const schema = readFileSync(new URL('../../config/d1/tournaments.sql', import.meta.url), 'utf8');

async function database(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(schema);
  return db;
}

/** A store's owner, signed in: what the demo's seed sets up. Answers the session token. */
async function organizer(db: Database): Promise<string> {
  const token = 'demo-token';
  db.run(
    'INSERT INTO users (id, email, pop_id, first_name, last_name, birth_date, created_at, handle, age_checked_at) ' +
      "VALUES ('u1', 'demo@example.com', '1000001', 'Demo', 'Organizer', '01/01/1990', 1, 'demo', 1)"
  );
  db.run(
    'INSERT INTO stores (id, league_id, status, name, address, country, time_zone, created_at, updated_at) ' +
      "VALUES ('s1', '900001', 'active', 'Demo Games', '1 Main St', 'US', 'America/Chicago', 1, 1)"
  );
  db.run("INSERT INTO store_members (store_id, user_id, role, added_at) VALUES ('s1', 'u1', 'owner', 1)");
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES (?, ?, ?, 1)', [
    await sha256(token),
    'u1',
    Date.now() + 1e9
  ]);
  return token;
}

const route = routerFor({
  '/api/me.ts': me as FunctionModule,
  '/api/tournaments/index.ts': tournaments as FunctionModule,
  '/api/tournaments/[code]/index.ts': event as FunctionModule,
  '/api/tournaments/[code]/commands.ts': commands as FunctionModule
});

function call(env: TournamentEnv, token: string, path: string, method = 'GET', body?: unknown) {
  return route(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { Cookie: `cm_session=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    env
  );
}

test('the real functions run over sql.js: an event is started, filled and paired', async () => {
  const db = await database();
  let writes = 0;
  const env: TournamentEnv = {
    TOURNAMENT_DB: browserD1(
      () => db,
      () => (writes += 1)
    ),
    EVENTS_DATA: demoBucket(
      () => db,
      () => {}
    )
  };
  const token = await organizer(db);

  const created = await call(env, token, '/api/tournaments', 'POST', {
    mode: 'swiss',
    name: 'Demo',
    roundTime: 50,
    store: 's1'
  });
  assert.equal(created.status, 201);
  const { code } = (await created.json()) as { code: string };
  for (let i = 0; i < 8; i += 1) {
    const added = await call(env, token, `/api/tournaments/${code}/commands`, 'POST', {
      command: {
        type: 'addPlayer',
        player: { firstName: 'P', lastName: `${i}`, id: `${2000 + i}`, birthDate: '06/15/1995' }
      },
      localTime: '11/07/2026 12:00:00'
    });
    assert.equal(added.status, 200);
  }
  const paired = await call(env, token, `/api/tournaments/${code}/commands`, 'POST', {
    command: { type: 'pairRound', pod: 'masters' },
    localTime: '11/07/2026 12:05:00'
  });
  assert.equal(paired.status, 200, await paired.clone().text());
  const view = (await (await call(env, token, `/api/tournaments/${code}`)).json()) as {
    tournament: { pods: { rounds: { matches: unknown[] }[] }[] };
  };
  assert.equal(view.tournament.pods[0]?.rounds.length, 1);
  assert.equal(view.tournament.pods[0]?.rounds[0]?.matches.length, 4);
  assert.ok(writes > 0);
});

test('the router ranks literal paths over parameters, and answers 404 and 405 as Pages does', async () => {
  const named = (name: string) => ({ onRequestGet: () => new Response(name) });
  const router = routerFor({
    '/api/stores/[id]/index.ts': named('store'),
    '/api/stores/join.ts': named('join'),
    '/api/x/[a]/[b].ts': { onRequestGet: (context: unknown) => Response.json((context as { params: unknown }).params) }
  });
  const get = (path: string, method = 'GET') => router(new Request(`${ORIGIN}${path}`, { method }), {});
  assert.equal(await (await get('/api/stores/join')).text(), 'join');
  assert.equal(await (await get('/api/stores/abc')).text(), 'store');
  assert.deepEqual(await (await get('/api/x/one/t%C3%A9')).json(), { a: 'one', b: 'té' });
  assert.equal((await get('/api/nowhere')).status, 404);
  assert.equal((await get('/api/stores/join', 'POST')).status, 405);
});

test('a batch is one transaction: a failing statement undoes the ones before it', async () => {
  const db = await database();
  const d1 = browserD1(
    () => db,
    () => {}
  );
  await assert.rejects(
    d1.batch([
      d1.prepare(
        "INSERT INTO stores (id, status, name, address, time_zone, created_at, updated_at) VALUES ('a', 'active', 'A', '', 'UTC', 1, 1)"
      ),
      d1.prepare('INSERT INTO nowhere VALUES (1)')
    ])
  );
  assert.equal(
    await d1
      .prepare('SELECT COUNT(*) AS n FROM stores')
      .first<{ n: number }>()
      .then(row => row?.n),
    0
  );
});

test('the bucket keeps what was published, and refuses a write over a newer one', async () => {
  const db = await database();
  const bucket = demoBucket(
    () => db,
    () => {}
  );
  const first = await bucket.put('k', 'one', { httpMetadata: {}, customMetadata: {} });
  assert.equal(bucket.read('k'), 'one');
  await bucket.put('k', 'two', { httpMetadata: {}, customMetadata: {} });
  assert.equal(
    await bucket.put('k', 'stale', { httpMetadata: {}, customMetadata: {}, onlyIf: { etagMatches: first!.etag } }),
    null
  );
  assert.equal(await (await bucket.get!('k'))!.text(), 'two');
  await bucket.delete('k');
  assert.equal(bucket.read('k'), null);
});

test('the demo’s own cookies go out with every request', () => {
  setCookie('cm_session', 'abc');
  setCookie('other', '2');
  assert.equal(cookieHeader(), 'cm_session=abc; other=2');
});

test('every demo list is a legal-sized list the site reads in full', () => {
  for (const list of Object.values(DEMO_LISTS)) {
    const parsed = parseDecklist(list.text);
    assert.equal(parsed.total, 60, list.archetype);
    assert.deepEqual(parsed.unread, [], list.archetype);
    assert.deepEqual(parsed.problems, [], list.archetype);
  }
});

test('every demo player has a list and a year of birth', () => {
  assert.equal(DEMO_ENTRANTS.length, 16);
  for (const entrant of DEMO_ENTRANTS) {
    assert.ok(DEMO_LISTS[entrant.list], entrant.name);
    assert.ok(entrant.birthYear > 1900 && entrant.birthYear < 2026, entrant.name);
  }
});
