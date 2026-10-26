/**
 * Penalty notes: what must hold is that they are staff's alone, fit the
 * event (its players, the rounds paired, its staff), are kept append-only
 * with an edit or removal landing once, and change nothing about the event
 * itself: a Game Loss or a Disqualification written down here is a note, and
 * the results, drops and standings stay as they were.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as penaltyNotes from '../../functions/api/tournaments/[code]/penalty-notes.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { type PenaltyNoteEntry, standingNotes } from '../../shared/tournament/penaltyNotes.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn, userOf } = apiCalls(() => env);
const calls = eventCalls(hit, signIn);
const { newSwiss, send, addPlayers, settle } = calls;

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

const record = (code: string, cookie: string | undefined, body: Record<string, unknown>) =>
  hit(penaltyNotes.onRequestPost as Handler, '/penalty-notes', at(code), { method: 'POST', cookie, body });

const readNotes = (code: string, cookie?: string, query = '') =>
  hit(penaltyNotes.onRequestGet as Handler, `/penalty-notes${query}`, at(code), { cookie });

const remove = (code: string, cookie: string, id: string) =>
  hit(penaltyNotes.onRequestDelete as Handler, `/penalty-notes?id=${id}`, at(code), { method: 'DELETE', cookie });

const entriesOf = (response: { json: { entries: PenaltyNoteEntry[] } }) => response.json.entries;

/** A running event (see eventCalls), with its organizer's account ID and its staff member's account. */
async function runningEvent() {
  const running = await calls.runningEvent();
  return { ...running, ownerId: (await userOf(running.owner)).id as string, helperUser: await userOf(running.helper) };
}

test('only staff read and record penalty notes', async () => {
  const { code, helper, ownerId } = await runningEvent();
  const player = await signIn('Player');
  assert.equal((await readNotes(code)).status, 401);
  assert.equal((await readNotes(code, player)).status, 403);
  const note = { playerId: '900', round: 1, judgeId: ownerId, penalty: 'warning', notes: 'Drew an extra card.' };
  assert.equal((await record(code, undefined, note)).status, 401);
  assert.equal((await record(code, player, note)).status, 403);
  const recorded = await record(code, helper, note);
  assert.equal(recorded.status, 200, 'staff who joined by the link record notes');
  const [entry] = entriesOf(recorded);
  assert.deepEqual(
    [entry?.playerName, entry?.round, entry?.judge.id, entry?.penalty, entry?.recordedBy, entry?.removed],
    ['Player 0', 1, ownerId, 'warning', 'helper', false]
  );
  const names = (await readNotes(code, helper)).json.judges.map((j: { name: string }) => j.name);
  assert.deepEqual(names.sort(), ['helper', 'organizer'], 'the organizer and the staff may be named as judges');
});

test('a penalty note fits the event: its player, a round paired for them, and its staff or a typed name', async () => {
  const { code, owner, ownerId } = await runningEvent();
  const strangerId = (await userOf(await signIn('Stranger'))).id;
  const base = { playerId: '900', round: 1, judgeId: ownerId, penalty: 'game-loss', notes: 'Marked cards.' };
  const refusals: [Record<string, unknown>, string][] = [
    [{ playerId: 'nobody' }, 'That player is not on this event'],
    [{ round: 2 }, 'Round 1 is the latest round paired for that player'],
    [{ round: 0 }, 'Say which round'],
    [{ penalty: 'Game Loss' }, 'Choose a penalty'],
    [{ judgeId: strangerId }, 'The judge must be on this event’s staff'],
    [{ judgeId: undefined }, 'Say which judge gave it'],
    [{ notes: 'x'.repeat(1001) }, 'Keep the notes under 1000 characters']
  ];
  for (const [change, error] of refusals) {
    const refused = await record(code, owner, { ...base, ...change });
    assert.deepEqual([refused.status, refused.json.error], [400, error], error);
  }
  const typed = await record(code, owner, { ...base, judgeId: undefined, judgeName: 'Head Judge Sam' });
  assert.deepEqual(entriesOf(typed)[0]?.judge, { id: null, name: 'Head Judge Sam' });
});

test('a note issues nothing: the event, its results and its roster stay as they were', async () => {
  const { code, owner, ownerId } = await runningEvent();
  const before = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  for (const penalty of ['match-loss', 'disqualification']) {
    const note = { playerId: '900', round: 1, judgeId: ownerId, penalty };
    assert.equal((await record(code, owner, note)).status, 200);
  }
  const after = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  assert.equal(after.version, before.version, 'no write to the event');
  assert.deepEqual(after.tournament, before.tournament);
});

test('an edit or removal is a new entry, lands once, and every version stays', async () => {
  const { code, owner, helper, ownerId } = await runningEvent();
  const first = entriesOf(
    await record(code, owner, { playerId: '900', round: 1, judgeId: ownerId, penalty: 'caution' })
  );
  const original = first[0]?.id as string;
  const edit = {
    playerId: '900',
    round: 1,
    judgeId: ownerId,
    penalty: 'warning',
    notes: 'Second time',
    replaces: original
  };
  const edited = await record(code, helper, edit);
  assert.equal(edited.status, 200);
  assert.equal(
    (await record(code, owner, { ...edit, notes: 'Again' })).status,
    409,
    'the second of two edits looks again'
  );

  const [standing] = standingNotes(entriesOf(edited));
  assert.deepEqual([standing?.penalty, standing?.notes, standing?.recordedBy], ['warning', 'Second time', 'helper']);
  assert.deepEqual(
    standing?.earlier.map(entry => [entry.id, entry.penalty]),
    [[original, 'caution']]
  );

  const removed = await remove(code, owner, standing?.id as string);
  assert.equal(removed.status, 200);
  assert.deepEqual(standingNotes(entriesOf(removed)), [], 'a removed note no longer stands');
  assert.equal(entriesOf(removed).length, 3, 'its versions and its removal stay on the record');
  assert.equal((await remove(code, owner, standing?.id as string)).status, 409);
  assert.equal((await remove(code, owner, 'made-up')).status, 404);
});

test('penalty notes read per player, go with their event, and name no one once an account is deleted', async () => {
  const { code, owner, helper, ownerId, helperUser } = await runningEvent();
  await record(code, owner, { playerId: '900', round: 1, judgeId: helperUser.id, penalty: 'warning' });
  await record(code, owner, { playerId: '901', round: 1, judgeId: ownerId, penalty: 'caution' });
  assert.deepEqual(
    entriesOf(await readNotes(code, owner, '?player=901')).map(entry => entry.playerId),
    ['901']
  );

  await settle(code, owner, { finished: true });
  const body = { confirm: helperUser.handle };
  const gone = await hit(me.onRequestDelete as Handler, '/api/me', {}, { method: 'DELETE', cookie: helper, body });
  assert.equal(gone.status, 204);
  const after = entriesOf(await readNotes(code, owner, '?player=900'))[0];
  assert.deepEqual([after?.judge, after?.recordedBy], [{ id: null, name: null }, 'organizer']);

  assert.equal(
    (await hit(event.onRequestDelete as Handler, '', at(code), { method: 'DELETE', cookie: owner })).status,
    204
  );
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM penalty_notes').get() as { n: number }).n, 0);
});

test('a note whose event is deleted before it is written leaves nothing behind', async () => {
  const { code, owner, ownerId } = await runningEvent();
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO penalty_notes', () => {
    db.raw.prepare('DELETE FROM tournaments WHERE code = ?').run(code);
  });
  const refused = await record(code, owner, { playerId: '900', round: 1, judgeId: ownerId, penalty: 'warning' });
  env.TOURNAMENT_DB = db;
  assert.deepEqual([refused.status, refused.json.error], [404, 'No such tournament']);
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM penalty_notes').get() as { n: number }).n, 0);
});
