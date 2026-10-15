/**
 * What staff read of the event's staff, its head judge and its records costs
 * the database: the head judge comes with the event's own row, and the staff
 * list is read once, in the batch that writes when there is a write. A staff
 * member named by account is checked in that write, so one taken off staff
 * meanwhile is never written down.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as corrections from '../../functions/api/tournaments/[code]/corrections.ts';
import * as headJudge from '../../functions/api/tournaments/[code]/head-judge.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as penaltyNotes from '../../functions/api/tournaments/[code]/penalty-notes.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { countingTrips, racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

const userId = (name: string) =>
  (db.raw.prepare('SELECT id FROM users WHERE handle = ?').get(name) as { id: string }).id;

/** A Swiss event in round 1 with four players, its organizer, and a staff member who joined by the invite link. */
async function runningEvent() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const { staffToken } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const helper = await signIn('Helper');
  await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: staffToken }
  });
  assert.equal((await send(code, owner, { type: 'pairRound', pod: 'masters' })).status, 200);
  return { owner, helper, code };
}

/** Runs `call` counting its round trips to the database, and hands back its answer with them. */
async function counted<T>(call: () => Promise<T>): Promise<[T, number]> {
  const counting = countingTrips(db);
  env.TOURNAMENT_DB = counting.db;
  try {
    return [await call(), counting.trips()];
  } finally {
    env.TOURNAMENT_DB = db;
  }
}

const putHeadJudge = (code: string, cookie: string, id: string | null) =>
  hit(headJudge.onRequestPut as Handler, '/head-judge', at(code), { method: 'PUT', cookie, body: { userId: id } });

const note = (code: string, cookie: string, judgeId: string) =>
  hit(penaltyNotes.onRequestPost as Handler, '/penalty-notes', at(code), {
    method: 'POST',
    cookie,
    body: { playerId: '900', round: 1, judgeId, penalty: 'warning', notes: 'Extra card.' }
  });

test('the head judge is read in two trips and named in two, answering who it is and the staff', async () => {
  const { owner, code } = await runningEvent();
  const helperId = userId('helper');
  const [named, putTrips] = await counted(() => putHeadJudge(code, owner, helperId));
  assert.equal(named.status, 200);
  assert.equal(named.json.headJudge.id, helperId);
  assert.deepEqual(named.json.staff.map((s: { id: string }) => s.id).sort(), [helperId, userId('organizer')].sort());
  assert.equal(putTrips, 2, 'the event and its asker, then the write and the staff it leaves');
  const [read, getTrips] = await counted(() =>
    hit(headJudge.onRequestGet as Handler, '/head-judge', at(code), { cookie: owner })
  );
  assert.deepEqual(read.json, named.json);
  assert.equal(getTrips, 2, 'the event, then the staff');
  const [cleared] = await counted(() => putHeadJudge(code, owner, null));
  assert.equal(cleared.json.headJudge, null);
});

test('a head judge taken off staff is no head judge, and one taken off meanwhile is not named', async () => {
  const { owner, code } = await runningEvent();
  const helperId = userId('helper');
  assert.equal((await putHeadJudge(code, owner, helperId)).status, 200);
  db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code);
  assert.equal(
    (await hit(headJudge.onRequestGet as Handler, '/head-judge', at(code), { cookie: owner })).json.headJudge,
    null
  );
  const read = await hit(corrections.onRequestGet as Handler, '/corrections', at(code), { cookie: owner });
  assert.deepEqual([read.json.headJudge, read.json.approver], [null, 'organizer']);
  assert.equal((await putHeadJudge(code, owner, null)).status, 200);
  db.raw.prepare('INSERT INTO staff VALUES (?, ?, 1)').run(code, helperId);
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET head_judge', () =>
    db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code)
  );
  const named = await putHeadJudge(code, owner, helperId);
  assert.deepEqual([named.status, named.json.error], [400, 'The head judge must be on this event’s staff']);
  env.TOURNAMENT_DB = db;
  assert.equal(db.raw.prepare('SELECT head_judge FROM tournaments WHERE code = ?').get(code)?.head_judge, null);
});

test('a penalty note naming a judge by account is written and answered in two trips', async () => {
  const { helper, code } = await runningEvent();
  const [recorded, trips] = await counted(() => note(code, helper, userId('organizer')));
  assert.equal(recorded.status, 200);
  assert.equal(recorded.json.entries.length, 1);
  assert.equal(trips, 2, 'the event and its asker, then the write, the record and the staff');
  const [read, readTrips] = await counted(() =>
    hit(penaltyNotes.onRequestGet as Handler, '/penalty-notes', at(code), { cookie: helper })
  );
  assert.deepEqual(read.json, recorded.json);
  assert.equal(readTrips, 2, 'the event, then the record and the staff');
});

test('a judge taken off staff between the read and the write is not written down', async () => {
  const { owner, code } = await runningEvent();
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO penalty_notes', () =>
    db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code)
  );
  const recorded = await note(code, owner, userId('helper'));
  assert.deepEqual([recorded.status, recorded.json.error], [400, 'The judge must be on this event’s staff']);
  env.TOURNAMENT_DB = db;
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM penalty_notes').get() as { n: number }).n, 0);
});
