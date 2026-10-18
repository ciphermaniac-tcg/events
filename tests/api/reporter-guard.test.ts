/**
 * A player's report or request is theirs only while the seat they were found
 * to hold stays theirs: staff releasing it, or another device claiming it
 * again, between the request's read and its write keeps the write from
 * landing, its evidence included, and a write tried again after another one
 * got there first is judged on the seat as it is then. Releasing a seat need
 * not move the event's version, so the event's own check would not see it.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, playerSays } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
  report._resetRateLimitStore();
});

const NOT_REPORTER = 'Someone else is already reporting for this player. Ask staff if that’s wrong.';

const count = (sql: string, ...values: string[]) =>
  (db.raw.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...values) as { n: number }).n;

/** Runs `change` just ahead of the event's own write: as if it landed between the request's read and its write. */
const meanwhile = (change: () => void) => {
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', change);
};

const release = (code: string, player: string) =>
  db.raw.prepare('DELETE FROM report_devices WHERE code = ? AND player_id = ?').run(code, player);

const bump = (code: string) => db.raw.prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);

/** What the event holds of the player's reports: reports waiting for staff, filed evidence, open requests. */
async function filed(code: string) {
  env.TOURNAMENT_DB = db;
  const row = await loadTournament(db, code);
  return {
    reports: row?.reports.length,
    evidence: count('report_history WHERE code = ?', code),
    requests: row?.requests.length
  };
}

/** A sanctioned event with round one paired and players reporting, its first player's seat claimed by their phone. */
async function reporting() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  assert.equal(paired.status, 200);
  await settle(code, owner, { playerReporting: true });
  const player = paired.json.tournament.pods[0].rounds[0].matches[0].p1 as string;
  const claimed = await playerSays(code, { popId: player, device: 'old-phone' });
  assert.equal(claimed.json.reporter, true);
  const reportAs = (body: Record<string, unknown> = { result: 'win' }) =>
    playerSays(code, { popId: player, device: 'old-phone', reportToken: claimed.json.reportToken, ...body });
  return { owner, code, player, reportAs };
}

test('a report from a seat staff released meanwhile files nothing and claims no seat again', async () => {
  const { code, player, reportAs } = await reporting();
  meanwhile(() => release(code, player));
  const sent = await reportAs();
  assert.deepEqual([sent.status, sent.json.error], [403, NOT_REPORTER]);
  assert.deepEqual(await filed(code), { reports: 0, evidence: 0, requests: 0 });
  assert.equal(count('report_devices WHERE code = ?', code), 0);
});

test('a report from a seat another device claimed meanwhile files nothing, and leaves that device its seat', async () => {
  const { code, player, reportAs } = await reporting();
  meanwhile(() => {
    release(code, player);
    db.raw
      .prepare(
        "INSERT INTO report_devices (code, player_id, token_hash, device, claimed_at) VALUES (?, ?, 'new', 'new-phone', 1)"
      )
      .run(code, player);
  });
  const sent = await reportAs();
  assert.deepEqual([sent.status, sent.json.error], [403, NOT_REPORTER]);
  assert.deepEqual(await filed(code), { reports: 0, evidence: 0, requests: 0 });
  const seat = db.raw
    .prepare('SELECT token_hash FROM report_devices WHERE code = ? AND player_id = ?')
    .get(code, player) as {
    token_hash: string;
  };
  assert.equal(seat.token_hash, 'new');
});

test('a report beaten to the event by another write is refused on the retry once its seat is gone', async () => {
  const { code, player, reportAs } = await reporting();
  meanwhile(() => {
    bump(code);
    release(code, player);
  });
  const sent = await reportAs();
  assert.deepEqual([sent.status, sent.json.error], [403, NOT_REPORTER], 'refused, not busy');
  assert.deepEqual(await filed(code), { reports: 0, evidence: 0, requests: 0 });
  assert.equal(count('report_devices WHERE code = ?', code), 0, 'the retry claims no seat afresh');
});

test('a report beaten to the event by another write lands on the retry while its seat stands', async () => {
  const { code, reportAs } = await reporting();
  meanwhile(() => bump(code));
  const sent = await reportAs();
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.deepEqual(await filed(code), { reports: 1, evidence: 1, requests: 0 });
});

test('a request to staff from a seat staff released meanwhile asks nothing', async () => {
  const { code, player, reportAs } = await reporting();
  meanwhile(() => release(code, player));
  const asked = await reportAs({ request: 'staff' });
  assert.deepEqual([asked.status, asked.json.error], [403, NOT_REPORTER]);
  assert.deepEqual(await filed(code), { reports: 0, evidence: 0, requests: 0 });
});

test('a request to staff from a seat that stands still asks', async () => {
  const { code, reportAs } = await reporting();
  const asked = await reportAs({ request: 'staff' });
  assert.equal(asked.status, 200, JSON.stringify(asked.json));
  assert.equal((await filed(code)).requests, 1);
});

/** A sanctioned event with round one paired, whose player 900 is the signed-in account holding that POP ID. */
async function reportingAccount() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { playerReporting: true });
  await addPlayers(code, owner, 4);
  const account = await signIn('Player');
  const profile = { popId: '900', firstName: 'Player', lastName: '0', birthDate: '02/27/1990' };
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: account, body: profile });
  const own = await playerSays(code, { popId: '900', device: 'phone' }, { cookie: account });
  assert.deepEqual([own.json.reporter, own.json.linked], [true, true]);
  assert.equal((await send(code, owner, { type: 'pairRound', pod: 'masters' })).status, 200);
  // From a device that holds no token: the account alone is the reporter.
  const reportAs = () => playerSays(code, { popId: '900', result: 'win', device: 'laptop' }, { cookie: account });
  return { code, reportAs };
}

test('an account reporting as its player, signed out meanwhile, files nothing', async () => {
  const { code, reportAs } = await reportingAccount();
  meanwhile(() => db.raw.exec("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE handle = 'player')"));
  const sent = await reportAs();
  assert.deepEqual([sent.status, sent.json.error], [403, NOT_REPORTER]);
  assert.deepEqual(await filed(code), { reports: 0, evidence: 0, requests: 0 });
});

test('an account reporting as its player, its POP ID gone meanwhile, files nothing', async () => {
  const { code, reportAs } = await reportingAccount();
  meanwhile(() => db.raw.exec("UPDATE users SET pop_id = '777' WHERE handle = 'player'"));
  const sent = await reportAs();
  assert.deepEqual([sent.status, sent.json.error], [403, NOT_REPORTER]);
  assert.deepEqual(await filed(code), { reports: 0, evidence: 0, requests: 0 });
});

test('an account reporting as its player from a device without the token files while it holds the seat', async () => {
  const { code, reportAs } = await reportingAccount();
  const sent = await reportAs();
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.deepEqual(await filed(code), { reports: 1, evidence: 1, requests: 0 });
});
