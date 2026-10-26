/**
 * Result corrections. What must hold: only the organizer or the event's head
 * judge corrects a result, and the head judge only while on the staff; a
 * correction lands only in the handbook's window, only on the event as it
 * was previewed (a write since refuses it, and it is not tried again), and
 * always with its audit entry beside it; it changes that one result and no
 * other round.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import * as corrections from '../../functions/api/tournaments/[code]/corrections.ts';
import * as headJudge from '../../functions/api/tournaments/[code]/head-judge.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import type { CorrectionEntry } from '../../shared/tournament/corrections.ts';
import type { Match, Pod, Tournament } from '../../shared/tournament/types.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, joinStaff } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

const managed = async (code: string, cookie: string) =>
  (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie })).json as {
    version: number;
    tournament: Tournament;
    staffToken: string;
  };

const masters = (t: Tournament) => t.pods.find(pod => pod.category === 'masters') as Pod;

/** Every two-player match of the latest round won by its first seat. */
async function reportAll(code: string, owner: string) {
  const round = masters((await managed(code, owner)).tournament).rounds.at(-1)!;
  for (const m of round.matches.filter(match => match.p2 !== null)) {
    const command = { type: 'reportResult', pod: 'masters', round: round.number, ...pick(m), outcome: 'p1' };
    assert.equal((await send(code, owner, command)).status, 200);
  }
}

const pick = (m: Match) => ({ table: m.table, p1: m.p1, p2: m.p2 });

const userOf = async (cookie: string) => (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user;

/** Eight players, round 1 played and round 2 paired, with the organizer and a staff member who joined by link. */
async function inRound2() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 8);
  const helper = await signIn('Helper');
  await joinStaff(code, owner, helper);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  await reportAll(code, owner);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  return { owner, helper, code, helperUser: await userOf(helper) };
}

/** Round 1 table 1 turned around, as the console sends it on the event's current version. */
async function flipTable1(code: string, cookie: string, change: Record<string, unknown> = {}) {
  const view = await managed(code, cookie);
  const match = masters(view.tournament).rounds[0]!.matches.find(m => m.table === 1)!;
  return {
    pod: 'masters',
    round: 1,
    ...pick(match),
    outcome: 'p2',
    note: 'Slip for table 1 has the wrong winner circled.',
    version: view.version,
    localTime: '10/10/2026 13:05:00',
    ...change
  };
}

const correct = (code: string, cookie: string | undefined, body: Record<string, unknown>) =>
  hit(corrections.onRequestPost as Handler, '/corrections', at(code), { method: 'POST', cookie, body });

const record = async (code: string, cookie: string) =>
  (await hit(corrections.onRequestGet as Handler, '/corrections', at(code), { cookie })).json as {
    corrections: CorrectionEntry[];
    headJudge: { id: string; name: string } | null;
    approver: string | null;
  };

const nameHeadJudge = (code: string, cookie: string, userId: string | null) =>
  hit(headJudge.onRequestPut as Handler, '/head-judge', at(code), { method: 'PUT', cookie, body: { userId } });

test('the organizer corrects round 1 during round 2, alone when no head judge is named', async () => {
  const { code, owner } = await inRound2();
  const before = await managed(code, owner);
  const body = await flipTable1(code, owner);
  const corrected = await correct(code, owner, body);
  assert.equal(corrected.status, 200, JSON.stringify(corrected.json));

  const after = corrected.json as { version: number; tournament: Tournament };
  assert.equal(after.version, before.version + 1);
  const match = masters(after.tournament).rounds[0]!.matches.find(m => m.table === 1)!;
  assert.deepEqual([match.outcome, match.timestamp], ['p2', '10/10/2026 13:05:00']);
  assert.deepEqual(
    masters(after.tournament).rounds[1],
    masters(before.tournament).rounds[1],
    'round 2 stays as paired'
  );

  const { corrections: entries, approver } = await record(code, owner);
  assert.equal(approver, 'organizer');
  assert.deepEqual(
    entries.map(e => [e.round, e.table, e.from, e.to, e.note, e.approvedBy, e.role, e.alone, e.during]),
    [[1, 1, 'p1', 'p2', body.note, 'organizer', 'organizer', true, 2]]
  );
});

test('only the organizer or the head judge corrects, and the head judge only while on staff', async () => {
  const { code, owner, helper, helperUser } = await inRound2();
  const player = await signIn('Player');
  assert.equal((await correct(code, undefined, await flipTable1(code, owner))).status, 401);
  assert.equal((await correct(code, player, await flipTable1(code, owner))).status, 403);
  const refused = await correct(code, helper, await flipTable1(code, owner));
  assert.deepEqual(
    [refused.status, refused.json.error],
    [403, 'Only the organizer or the head judge can correct a result']
  );
  assert.equal((await record(code, helper)).approver, null);

  const stranger = await userOf(await signIn('Stranger'));
  assert.equal((await nameHeadJudge(code, owner, stranger.id)).status, 400, 'the head judge must be on staff');
  assert.equal((await nameHeadJudge(code, helper, helperUser.id)).status, 403, 'only the organizer names one');
  assert.deepEqual((await nameHeadJudge(code, owner, helperUser.id)).json.headJudge, {
    id: helperUser.id,
    name: 'helper'
  });

  assert.equal((await record(code, helper)).approver, 'head-judge');
  assert.equal((await correct(code, helper, await flipTable1(code, owner))).status, 200);
  assert.equal((await correct(code, owner, await flipTable1(code, owner, { outcome: 'tie' }))).status, 200);
  const entries = (await record(code, owner)).corrections;
  assert.deepEqual(
    entries.map(e => [e.to, e.approvedBy, e.role, e.alone]),
    [
      ['tie', 'organizer', 'organizer', false],
      ['p2', 'helper', 'head-judge', false]
    ],
    'newest first; the organizer is not alone once a head judge is named'
  );

  await hit(staff.onRequestDelete as Handler, `/staff?user=${helperUser.id}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal((await record(code, owner)).headJudge, null, 'off the staff, no longer head judge');
  assert.equal((await correct(code, helper, await flipTable1(code, owner, { outcome: 'p1' }))).status, 403);
});

test('a correction previewed on an older version of the event is refused and writes nothing', async () => {
  const { code, owner } = await inRound2();
  const stale = await flipTable1(code, owner);
  await settle(code, owner, { details: 'Prizes at the counter.' });
  const refused = await correct(code, owner, stale);
  assert.deepEqual(
    [refused.status, refused.json.error],
    [409, 'The event changed since you looked. Look again and try once more.']
  );
  assert.deepEqual((await record(code, owner)).corrections, []);
  const match = masters((await managed(code, owner)).tournament).rounds[0]!.matches.find(m => m.table === 1)!;
  assert.equal(match.outcome, 'p1');
});

test('a correction outside the window, or of a match that changed, is refused', async () => {
  const { code, owner } = await inRound2();
  const refusals: [Record<string, unknown>, string][] = [
    [{ round: 2 }, 'Round 2 is the current round. Change its results from its table.'],
    [{ p2: 'someone' }, 'That match has changed. Look again.'],
    [{ outcome: 'p1' }, 'That is already its result.'],
    [{ note: '' }, 'Say which slip and what was wrong']
  ];
  for (const [change, error] of refusals) {
    const refused = await correct(code, owner, await flipTable1(code, owner, change));
    assert.deepEqual([refused.status, refused.json.error], [400, error], error);
  }
  await reportAll(code, owner);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const locked = await correct(code, owner, await flipTable1(code, owner));
  assert.deepEqual(
    [locked.status, locked.json.error],
    [400, 'Round 1 can no longer be corrected. Its records locked when round 3 was paired.']
  );
  await settle(code, owner, { finished: true });
  assert.equal((await correct(code, owner, await flipTable1(code, owner))).json.error, 'The event has ended.');
});

test('corrections name no one once the approver is deleted, and go with their event', async () => {
  const { code, owner, helper, helperUser } = await inRound2();
  await nameHeadJudge(code, owner, helperUser.id);
  assert.equal((await correct(code, helper, await flipTable1(code, owner))).status, 200);
  await settle(code, owner, { finished: true });
  const body = { confirm: helperUser.handle };
  const gone = await hit(me.onRequestDelete as Handler, '/api/me', {}, { method: 'DELETE', cookie: helper, body });
  assert.equal(gone.status, 204);
  const [entry] = (await record(code, owner)).corrections;
  assert.deepEqual([entry?.approvedBy, entry?.role], [null, 'head-judge']);
  assert.equal(
    (db.raw.prepare('SELECT head_judge FROM tournaments').get() as { head_judge: string | null }).head_judge,
    null
  );

  assert.equal(
    (await hit(event.onRequestDelete as Handler, '', at(code), { method: 'DELETE', cookie: owner })).status,
    204
  );
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM result_corrections').get() as { n: number }).n, 0);
});

test('staff read the head judge and who could be named; anyone else does not, and a name must be an account', async () => {
  const { code, owner, helper, helperUser } = await inRound2();
  const read = (cookie?: string) => hit(headJudge.onRequestGet as Handler, '/head-judge', at(code), { cookie });
  assert.equal((await read()).status, 401);
  assert.equal((await read(await signIn('Player'))).status, 403);
  const seen = await read(helper);
  assert.equal(seen.status, 200);
  assert.equal(seen.json.headJudge, null);
  assert.deepEqual((seen.json.staff as { name: string }[]).map(member => member.name).sort(), ['helper', 'organizer']);
  const malformed = await hit(headJudge.onRequestPut as Handler, '/head-judge', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { userId: 7 }
  });
  assert.deepEqual([malformed.status, malformed.json.error], [400, 'Say who the head judge is']);
  await nameHeadJudge(code, owner, helperUser.id);
  assert.equal((await nameHeadJudge(code, owner, null)).json.headJudge, null, 'null names none');
});

test('deleting the rounds after a locked one does not reopen it, to a correction or to its results', async () => {
  const { code, owner } = await inRound2();
  await reportAll(code, owner);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const locked = 'Round 1 can no longer be corrected. Its records locked when round 3 was paired.';
  assert.equal((await correct(code, owner, await flipTable1(code, owner))).json.error, locked);

  assert.equal((await send(code, owner, { type: 'deleteRound', pod: 'masters' })).status, 200);
  assert.equal(masters((await managed(code, owner)).tournament).rounds.length, 2, 'round 3 is gone');
  assert.equal((await correct(code, owner, await flipTable1(code, owner))).json.error, locked, 'still locked');

  // Clearing round 2's results lets it be deleted too, which leaves round 1 the latest round.
  const r2 = masters((await managed(code, owner)).tournament).rounds[1]!;
  for (const m of r2.matches.filter(match => match.p2 !== null)) {
    await send(code, owner, { type: 'reportResult', pod: 'masters', round: 2, ...pick(m), outcome: 'pending' });
  }
  assert.equal((await send(code, owner, { type: 'deleteRound', pod: 'masters' })).status, 200);
  const r1 = masters((await managed(code, owner)).tournament).rounds;
  assert.equal(r1.length, 1);
  const entry = await send(code, owner, {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    ...pick(r1[0]!.matches.find(m => m.table === 1)!),
    outcome: 'p2'
  });
  assert.deepEqual([entry.status, entry.json.error], [400, locked], 'its results stay as they were');
  const stored = db.raw.prepare('SELECT paired_through FROM tournaments').get() as { paired_through: string };
  assert.deepEqual(JSON.parse(stored.paired_through), { masters: 3 });
});

test('naming another head judge makes a new version, so a correction previewed before it is refused', async () => {
  const { code, owner, helper, helperUser } = await inRound2();
  await nameHeadJudge(code, owner, helperUser.id);
  const previewed = await flipTable1(code, helper);
  const before = (await managed(code, owner)).version;
  await nameHeadJudge(code, owner, null);
  assert.equal((await managed(code, owner)).version, before + 1);
  const refused = await correct(code, helper, previewed);
  assert.equal(refused.status, 403, 'no longer head judge');
  assert.deepEqual((await record(code, owner)).corrections, []);
});

/** A correction whose approver loses the right to approve between the route's check and its write. */
async function revokedMidWrite(meanwhile: (code: string) => void, as: 'owner' | 'helper') {
  const { code, owner, helper, helperUser } = await inRound2();
  await nameHeadJudge(code, owner, helperUser.id);
  const body = await flipTable1(code, owner);
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO result_corrections', () => meanwhile(code));
  const refused = await correct(code, as === 'owner' ? owner : helper, body);
  env.TOURNAMENT_DB = db;
  assert.deepEqual(
    [refused.status, refused.json.error],
    [409, 'The event changed since you looked. Look again and try once more.']
  );
  // Read by the staff member the link let in, who stays on staff whoever lost what.
  const match = masters((await managed(code, helper)).tournament).rounds[0]!.matches.find(m => m.table === 1)!;
  assert.equal(match.outcome, 'p1', 'the result stands');
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM result_corrections').get() as { n: number }).n, 0);
}

test('a head judge replaced as their correction is written changes nothing', async () => {
  // Without a new version, as a write that slipped past the version guard would be.
  await revokedMidWrite(
    code => db.raw.prepare('UPDATE tournaments SET head_judge = NULL WHERE code = ?').run(code),
    'helper'
  );
});

test('an organizer no longer the event’s as their correction is written changes nothing', async () => {
  await revokedMidWrite(code => {
    // Out of the store that runs it, and not the account that started it either.
    db.raw
      .prepare('DELETE FROM store_members WHERE store_id = (SELECT store_id FROM tournaments WHERE code = ?)')
      .run(code);
    db.raw.prepare("UPDATE tournaments SET owner_id = 'someone' WHERE code = ?").run(code);
  }, 'owner');
});
