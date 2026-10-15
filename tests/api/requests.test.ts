/**
 * Players' requests to staff end to end, against the real schema in SQLite.
 * What must hold: only the device that reports for a player asks for them;
 * a request is public by the player's public key without who answered it;
 * staff answer the request they saw, once, by name, and a confirmed drop
 * drops the player in the same write; the player can cancel only
 * before then; an ended event takes no requests.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as requests from '../../functions/api/tournaments/[code]/requests.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';
import { REQUEST_COOLDOWN_MS, TOO_SOON } from '../../shared/tournament/requests.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, playerSays, view } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  report._resetRateLimitStore();
  event._resetRateLimitStore();
});
afterEach(() => mock.timers.reset());

/** The event's stored version: what a write bumps and a publish follows. */
const versionOf = async (code: string) => (await view(code)).version;

/** An event with four players, its organizer, and the first player's phone, which holds their reporting seat. */
async function eventWithPhone() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const popId = '900';
  const device = 'phone-900';
  const said = await playerSays(code, { popId, device });
  assert.equal(said.json.reporter, true);
  const reportToken = said.json.reportToken as string;
  const ask = (body: Record<string, unknown>) => playerSays(code, { popId, device, reportToken, ...body });
  const answer = (body: Record<string, unknown>) =>
    hit(requests.onRequestPut as Handler, '/requests', at(code), { method: 'PUT', cookie: owner, body });
  /** The player's request of `kind` as the public copy has it. */
  const shown = async (kind: string) => (await view(code)).requests?.find(request => request.kind === kind);
  const droppedAfter = async () =>
    (await view(code)).tournament.players.find(player => player.firstName === 'Player' && player.lastName === '0')
      ?.droppedAfter;
  return { owner, code, popId, ask, answer, shown, droppedAfter };
}

test('the reporting device asks to drop, publicly by key, and staff confirm it by name and ID', async () => {
  const { owner, code, popId, ask, answer, shown, droppedAfter } = await eventWithPhone();
  const asked = await ask({ request: 'drop' });
  assert.equal(asked.status, 200, JSON.stringify(asked.json));
  const key = asked.json.key as string;
  const open = await shown('drop');
  assert.deepEqual([open?.player, open?.status], [key, 'open']);
  const stranger = await playerSays(code, { popId, device: 'someone-else', request: 'drop' });
  assert.equal(stranger.status, 403, 'another device cannot ask for the player');
  assert.equal((await answer({ id: open?.id, status: 'done' })).status, 400, 'a contact answer does not fit a drop');
  assert.equal((await answer({ id: 'unknown', status: 'accepted' })).status, 400);
  const before = await versionOf(code);
  const confirmed = await answer({ id: open?.id, status: 'accepted' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.deepEqual(
    confirmed.json.requests.map(({ player, status, by }: Record<string, unknown>) => ({ player, status, by })),
    [{ player: popId, status: 'accepted', by: 'organizer' }]
  );
  assert.equal(await versionOf(code), before + 1, 'the drop and its answer are one write');
  assert.notEqual(await droppedAfter(), null, 'confirming the drop dropped the player');
  assert.equal((await shown('drop'))?.by, undefined, 'the public copy does not name staff');
  assert.equal((await answer({ id: open?.id, status: 'declined' })).status, 400, 'answered once');
  const managed = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.equal(managed.json.requests[0].by, 'organizer');
});

test('a confirmation from a stale console does not drop a player who cancelled and asked again', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T17:00:00Z') });
  const { code, ask, answer, shown, droppedAfter } = await eventWithPhone();
  await ask({ request: 'drop' });
  const seen = await shown('drop');
  assert.equal((await ask({ request: 'drop', cancel: true })).status, 200);
  const before = await versionOf(code);
  const stale = await answer({ id: seen?.id, status: 'accepted' });
  assert.equal(stale.status, 400);
  assert.equal(await droppedAfter(), null, 'nothing dropped');
  assert.equal(await versionOf(code), before, 'nothing written');
  mock.timers.tick(REQUEST_COOLDOWN_MS);
  assert.equal((await ask({ request: 'drop' })).status, 200);
  const again = await shown('drop');
  assert.notEqual(again?.id, seen?.id, 'a new request has a new ID');
  assert.equal((await answer({ id: seen?.id, status: 'accepted' })).status, 400, 'the old answer still misses');
  assert.equal(await droppedAfter(), null);
  assert.equal((await answer({ id: again?.id, status: 'accepted' })).status, 200);
  assert.notEqual(await droppedAfter(), null);
});

test('asking again for an open request writes nothing, and cancelling then asking waits for the cooldown', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T17:00:00Z') });
  const { code, ask } = await eventWithPhone();
  await ask({ request: 'staff' });
  const version = await versionOf(code);
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await ask({ request: 'staff' })).status, 200);
  }
  assert.equal(await versionOf(code), version, 'repeats change nothing');
  const cancelled = await ask({ request: 'staff', cancel: true });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.view.requests[0].status, 'cancelled');
  const soon = await ask({ request: 'staff' });
  assert.equal(soon.status, 429);
  assert.equal(soon.json.error, TOO_SOON);
  mock.timers.tick(REQUEST_COOLDOWN_MS - 1);
  assert.equal((await ask({ request: 'staff' })).status, 429);
  mock.timers.tick(1);
  assert.equal((await ask({ request: 'staff' })).status, 200);
});

test('a player cancels only an unanswered request, and asks again at once after an answer', async () => {
  const { ask, answer, shown } = await eventWithPhone();
  await ask({ request: 'staff' });
  assert.equal((await answer({ id: (await shown('staff'))?.id, status: 'done' })).status, 200);
  assert.equal((await ask({ request: 'staff', cancel: true })).status, 400);
  const again = await ask({ request: 'staff' });
  assert.equal(again.status, 200);
  assert.equal(again.json.view.requests[0].status, 'open');
  assert.equal((await ask({ request: 'judge' })).status, 400);
});

test('a dropped player or an ended event takes no drop request', async () => {
  const { owner, code, popId, ask } = await eventWithPhone();
  assert.equal((await send(code, owner, { type: 'dropPlayer', id: popId })).status, 200);
  const out = await ask({ request: 'drop' });
  assert.equal(out.status, 400);
  assert.match(out.json.error, /already out/);
  await settle(code, owner, { finished: true });
  assert.equal((await ask({ request: 'staff' })).status, 400);
});

test('only staff answer requests', async () => {
  const { code, ask, shown } = await eventWithPhone();
  await ask({ request: 'drop' });
  const player = await signIn('Player', null);
  const refused = await hit(requests.onRequestPut as Handler, '/requests', at(code), {
    method: 'PUT',
    cookie: player,
    body: { id: (await shown('drop'))?.id, status: 'accepted' }
  });
  assert.equal(refused.status, 403);
});

test('a request stored before requests had IDs stays answerable, and keeps its ID once written', async () => {
  const { code, ask, answer, shown, droppedAfter } = await eventWithPhone();
  await ask({ request: 'drop' });
  const db = (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;
  const stored = () =>
    JSON.parse(
      (db.prepare('SELECT requests FROM tournaments WHERE code = ?').get(code) as { requests: string }).requests
    ) as {
      id?: string;
      at: number;
    }[];
  // As c9bcd32 found them: the same request, stored with no ID.
  const legacy = stored().map(({ id: _id, ...request }) => request);
  db.prepare('UPDATE tournaments SET requests = ? WHERE code = ?').run(JSON.stringify(legacy), code);
  const read = await shown('drop');
  assert.equal(read?.id, `legacy:900:drop:${legacy[0]?.at}`, 'an ID from what the request holds');
  assert.equal((await shown('drop'))?.id, read?.id, 'the same on every read');
  const version = await versionOf(code);
  assert.equal((await ask({ request: 'drop' })).status, 200);
  assert.equal(await versionOf(code), version, 'asking again while it is open still writes nothing');
  assert.equal((await shown('drop'))?.id, read?.id);
  const confirmed = await answer({ id: read?.id, status: 'accepted' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.notEqual(await droppedAfter(), null);
  assert.equal(stored()[0]?.id, read?.id, 'the answer wrote the ID with it');
});
