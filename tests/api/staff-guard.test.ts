/**
 * A staff change is the asker's only while they hold their place: whatever
 * takes it away between the request's read and its write (taken off staff,
 * moved down in the store, signed out) keeps the write from landing, nothing
 * written beside the event included, and a write tried again is judged with
 * the role the asker holds then.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as headJudge from '../../functions/api/tournaments/[code]/head-judge.ts';
import * as penaltyNotes from '../../functions/api/tournaments/[code]/penalty-notes.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, playerSays, joinStaff } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
  report._resetRateLimitStore();
});

const count = (sql: string, ...values: string[]) =>
  (db.raw.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...values) as { n: number }).n;

/** Runs `meanwhile` just ahead of the next statement starting with `prefix`: as if it landed between read and write. */
const meanwhile = (prefix: string, change: () => void) => {
  env.TOURNAMENT_DB = racing(db, prefix, change);
};

const userId = (name: string) =>
  (db.raw.prepare('SELECT id FROM users WHERE handle = ?').get(name) as { id: string }).id;

/** An event its organizer runs, with four players and a staff member who joined by the invite link. */
async function withHelper() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const helper = await signIn('Helper');
  const joined = await joinStaff(code, owner, helper);
  assert.equal(joined.status, 200);
  return { owner, code, helper };
}

test('staff taken off the event while another write lands are not let through on the retry', async () => {
  const { code, helper } = await withHelper();
  meanwhile('UPDATE tournaments SET', () => {
    db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code);
    db.raw.prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);
  });
  const renamed = await send(code, helper, { type: 'updateInfo', info: { name: 'Renamed' } });
  assert.deepEqual([renamed.status, renamed.json.error], [403, 'Only this event’s staff can do that']);
  env.TOURNAMENT_DB = db;
  assert.equal((await loadTournament(db, code))?.tournament.info.name, 'Test Cup');
});

test('a write from staff signed out meanwhile changes neither the event nor its history index', async () => {
  const { code, helper } = await withHelper();
  const before = await loadTournament(db, code);
  const indexed = count('pop_history WHERE code = ?', code);
  meanwhile('UPDATE tournaments SET', () => {
    db.raw.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE handle = 'helper')").run();
  });
  const added = await send(code, helper, {
    type: 'addPlayer',
    player: { firstName: 'Late', lastName: 'Player', id: '950', birthDate: '02/27/1990' }
  });
  assert.deepEqual([added.status, added.json.error], [401, 'Sign in first']);
  env.TOURNAMENT_DB = db;
  const after = await loadTournament(db, code);
  assert.deepEqual([after?.version, after?.tournament.players.length], [before?.version, 4]);
  assert.equal(count('pop_history WHERE code = ?', code), indexed, 'nobody indexed for the change that did not land');
});

test('an organizer moved down to staff meanwhile is judged as staff on the retry', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  meanwhile('UPDATE tournaments SET', () => {
    db.raw.prepare("UPDATE store_members SET role = 'staff'").run();
  });
  const shown = await settle(code, owner, { deckVisibility: 'always' });
  assert.deepEqual([shown.status, shown.json.error], [403, 'Only the organizer can show decks sooner']);
  env.TOURNAMENT_DB = db;
  assert.notEqual((await loadTournament(db, code))?.settings.deckVisibility, 'always');
  // Still staff: a change any staff member may make goes through, answered with staff's view.
  const hidden = await settle(code, owner, { deckVisibility: 'off' });
  assert.deepEqual([hidden.status, hidden.json.role, hidden.json.staffToken], [200, 'staff', null]);
});

test('an organizer gone from the store meanwhile names no head judge and removes nobody', async () => {
  const { owner, code } = await withHelper();
  const helperId = userId('helper');
  const leave = () => db.raw.prepare("DELETE FROM store_members WHERE role = 'owner'").run();
  meanwhile('UPDATE tournaments SET head_judge', leave);
  const named = await hit(headJudge.onRequestPut as Handler, '/head-judge', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { userId: helperId }
  });
  assert.equal(named.status, 403);
  env.TOURNAMENT_DB = db;
  assert.equal(count('tournaments WHERE code = ? AND head_judge IS NOT NULL', code), 0);
});

test('an organizer gone from the store meanwhile takes nobody off staff and keeps the invite link', async () => {
  const { owner, code } = await withHelper();
  const token = (await loadTournament(db, code))?.staffToken;
  const leave = () => db.raw.prepare("DELETE FROM store_members WHERE role = 'owner'").run();
  meanwhile('DELETE FROM staff', leave);
  const removed = await hit(staff.onRequestDelete as Handler, `/staff?user=${userId('helper')}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(removed.status, 403);
  env.TOURNAMENT_DB = db;
  db.raw
    .prepare("INSERT INTO store_members SELECT store_id, ?, 'owner', 1 FROM tournaments WHERE code = ?")
    .run(userId('organizer'), code);
  meanwhile('UPDATE tournaments SET staff_token', leave);
  const rotated = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: owner,
    body: { rotate: true }
  });
  assert.equal(rotated.status, 403);
  env.TOURNAMENT_DB = db;
  assert.equal(count('staff WHERE code = ?', code), 1);
  assert.equal((await loadTournament(db, code))?.staffToken, token);
});

test('staff taken off the event meanwhile write no penalty note', async () => {
  const { owner, code, helper } = await withHelper();
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  assert.equal(paired.status, 200, JSON.stringify(paired.json));
  meanwhile('INSERT INTO penalty_notes', () => db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code));
  const note = { playerId: '900', round: 1, judgeName: 'Floor judge', penalty: 'warning', notes: 'Extra card.' };
  const recorded = await hit(penaltyNotes.onRequestPost as Handler, '/penalty-notes', at(code), {
    method: 'POST',
    cookie: helper,
    body: note
  });
  assert.equal(recorded.status, 403);
  assert.equal(count('penalty_notes WHERE code = ?', code), 0);
});

/** Deletes the event as the organizer signed in under `cookie`. */
const remove = (code: string, cookie: string) =>
  hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie });

/** What deleting the event takes with it, to tell it stands whole. */
const kept = (code: string) => [
  count('tournaments WHERE code = ?', code),
  count('staff WHERE code = ?', code),
  count('pop_history WHERE code = ?', code)
];

test('an organizer gone from the store meanwhile deletes nothing of the event', async () => {
  const { owner, code } = await withHelper();
  const before = kept(code);
  assert.deepEqual(before, [1, 1, 4]);
  meanwhile('UPDATE tournaments SET version = -version', () => {
    db.raw.prepare("DELETE FROM store_members WHERE role = 'owner'").run();
  });
  const removed = await remove(code, owner);
  assert.deepEqual([removed.status, removed.json.error], [403, 'Only this event’s staff can do that']);
  env.TOURNAMENT_DB = db;
  assert.deepEqual(kept(code), before);
});

test('a deletion tried again after another write is judged on the organizer as they are then', async () => {
  const { owner, code } = await withHelper();
  const before = kept(code);
  meanwhile('DELETE FROM tournaments', () => {
    db.raw.prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);
    db.raw.prepare("UPDATE store_members SET role = 'staff'").run();
  });
  const removed = await remove(code, owner);
  assert.deepEqual([removed.status, removed.json.error], [403, 'Only the organizer can delete the event']);
  env.TOURNAMENT_DB = db;
  assert.deepEqual(kept(code), before);
});

test('an organizer still in place deletes the event after another write, and again finds it gone', async () => {
  const { owner, code } = await withHelper();
  meanwhile('DELETE FROM tournaments', () => {
    db.raw.prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);
  });
  assert.equal((await remove(code, owner)).status, 204);
  env.TOURNAMENT_DB = db;
  assert.deepEqual(kept(code), [0, 0, 0]);
  assert.equal((await remove(code, owner)).status, 404);
});

const NOT_STAFF = 'Only this event’s staff can do that';

/**
 * The organizer's event with its helper, taking lists: one sent for Player
 * ID 4242 from a device, and two wrong birth years counted against it.
 */
async function withList() {
  const setup = await withHelper();
  await settle(setup.code, setup.owner, { decklists: 'open' });
  const sent = await hit(decklists.onRequestPut as Handler, '/decklists', at(setup.code), {
    method: 'PUT',
    body: {
      profile: { popId: '4242', firstName: 'A', lastName: 'B', birthDate: '01/01/1990' },
      deck: '60 Basic {P} Energy SVE 5',
      archetype: null
    }
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  db.raw
    .prepare('INSERT OR REPLACE INTO identify_failures (code, pop_id, failures, locked_until) VALUES (?, ?, 2, 0)')
    .run(setup.code, '4242');
  return setup;
}

const unlock = (code: string, cookie: string) =>
  hit(decklists.onRequestPatch as Handler, '/decklists?popId=4242', at(code), { method: 'PATCH', cookie });

/** Whether the list under 4242 is still its device's, and how many wrong years stand against 4242. */
function lockedList(code: string) {
  env.TOURNAMENT_DB = db;
  return {
    owned: count('decklists WHERE code = ? AND user_id = ? AND owner_token IS NOT NULL', code, 'pop:4242'),
    failures: count('identify_failures WHERE code = ? AND pop_id = ?', code, '4242')
  };
}

const UNLOCKING = 'UPDATE decklists SET owner_token';

test('an organizer gone from the store meanwhile unlocks no list and forgives no wrong birth year', async () => {
  const { owner, code } = await withList();
  meanwhile(UNLOCKING, () => db.raw.prepare("DELETE FROM store_members WHERE role = 'owner'").run());
  const unlocked = await unlock(code, owner);
  assert.deepEqual([unlocked.status, unlocked.json.error], [403, NOT_STAFF]);
  assert.deepEqual(lockedList(code), { owned: 1, failures: 1 });
});

test('staff taken off the event meanwhile unlock no list and forgive no wrong birth year', async () => {
  const { code, helper } = await withList();
  meanwhile(UNLOCKING, () => db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code));
  const unlocked = await unlock(code, helper);
  assert.deepEqual([unlocked.status, unlocked.json.error], [403, NOT_STAFF]);
  assert.deepEqual(lockedList(code), { owned: 1, failures: 1 });
});

test('staff signed out meanwhile unlock no list and forgive no wrong birth year', async () => {
  const { code, helper } = await withList();
  meanwhile(UNLOCKING, () => db.raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId('helper')));
  const unlocked = await unlock(code, helper);
  assert.equal(unlocked.status, 401);
  assert.deepEqual(lockedList(code), { owned: 1, failures: 1 });
});

test('an organizer moved down to staff meanwhile still unlocks a list, as any of its staff may', async () => {
  const { owner, code } = await withList();
  meanwhile(UNLOCKING, () => db.raw.prepare("UPDATE store_members SET role = 'staff'").run());
  assert.equal((await unlock(code, owner)).status, 204);
  assert.deepEqual(lockedList(code), { owned: 0, failures: 0 });
});

test('staff unlocking a list nobody sent still forgive its wrong birth years, and unlocking nothing answers alike', async () => {
  const { code, helper } = await withList();
  db.raw.prepare('DELETE FROM decklists WHERE code = ?').run(code);
  assert.equal((await unlock(code, helper)).status, 204);
  assert.deepEqual(lockedList(code), { owned: 0, failures: 0 });
  assert.equal((await unlock(code, helper)).status, 204);
});

/** The organizer's event with its helper, players reporting, player 900's seat claimed and a wrong year against them. */
async function withSeat() {
  const setup = await withHelper();
  await settle(setup.code, setup.owner, { playerReporting: true });
  assert.equal((await playerSays(setup.code, { popId: '900', device: 'phone' })).json.reporter, true);
  db.raw
    .prepare('INSERT OR REPLACE INTO identify_failures (code, pop_id, failures, locked_until) VALUES (?, ?, 2, 0)')
    .run(setup.code, '900');
  return setup;
}

const releaseSeat = (code: string, cookie: string) =>
  hit(report.onRequestDelete as Handler, '/report?player=900', at(code), { method: 'DELETE', cookie });

const seated = (code: string) => {
  env.TOURNAMENT_DB = db;
  return [count('report_devices WHERE code = ?', code), count('identify_failures WHERE code = ?', code)];
};

test('staff taken off the event meanwhile release no reporting seat and forgive no wrong birth year', async () => {
  const { code, helper } = await withSeat();
  meanwhile('DELETE FROM report_devices', () => db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code));
  const released = await releaseSeat(code, helper);
  assert.deepEqual([released.status, released.json.error], [403, NOT_STAFF]);
  assert.deepEqual(seated(code), [1, 1]);
});

test('staff still on the event release the seat and forgive its wrong birth years together', async () => {
  const { code, helper } = await withSeat();
  assert.equal((await releaseSeat(code, helper)).status, 204);
  assert.deepEqual(seated(code), [0, 0]);
});
