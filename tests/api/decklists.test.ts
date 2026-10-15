/**
 * Decklists once round 1 is paired, and the deck checks staff hold them to.
 * What must hold: pairing round 1 locks every list, whatever the open switch
 * says, even for a write that read the event before the pairing landed; a
 * player still reads their own list back; deck checks are staff's alone,
 * fit the event (its players, the rounds paired, its staff), and are kept
 * append-only, an edit or removal landing once.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import * as deckChecks from '../../functions/api/tournaments/[code]/deck-checks.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { type DeckCheckEntry, standingChecks } from '../../shared/tournament/deckChecks.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
});

const PROFILE = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
const LIST = { deck: '60 Basic {P} Energy SVE 5', archetype: null };

const submit = (code: string, extra: Record<string, unknown> = {}) =>
  hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: { ...LIST, profile: PROFILE, ...extra }
  });

const withdraw = (code: string, token: string) =>
  hit(decklists.onRequestDelete as Handler, `/decklists?popId=4242&token=${token}`, at(code), { method: 'DELETE' });

/** A Swiss event taking lists, with four players and one list in. */
async function eventWithList() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  await addPlayers(code, owner, 3);
  const sent = await submit(code);
  assert.equal(sent.status, 200);
  return { owner, code, token: sent.json.token as string };
}

const pair = (code: string, owner: string) => send(code, owner, { type: 'pairRound', pod: 'masters' });

test('pairing round 1 locks every list, and its player still reads theirs back', async () => {
  const { owner, code, token } = await eventWithList();
  assert.equal((await pair(code, owner)).status, 200);

  const replaced = await submit(code, { token, deck: '60 Basic {G} Energy SVE 1' });
  assert.deepEqual([replaced.status, replaced.json.error], [403, 'Decklists are locked once round 1 is paired']);
  const gone = await withdraw(code, token);
  assert.deepEqual([gone.status, gone.json.error], [403, 'Decklists are locked once round 1 is paired']);
  const late = await submit(code, { profile: { ...PROFILE, popId: '5151' } });
  assert.equal(late.status, 403, 'nor does a new list come in');

  await settle(code, owner, { decklists: 'open' });
  assert.equal((await submit(code, { token })).status, 403, 'the open switch does not reopen a locked event');

  const mine = await hit(decklists.onRequestGet as Handler, `/decklists?popId=4242&token=${token}`, at(code));
  assert.equal(mine.json.mine.deck, LIST.deck, 'the list as it was sent');
  const all = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.equal(all.json.decklists.length, 1, 'staff still read every list');
});

test('closing submission before round 1 still lets its player read their list back', async () => {
  const { owner, code, token } = await eventWithList();
  await settle(code, owner, { decklists: 'closed' });
  assert.equal((await submit(code, { token })).json.error, 'Decklist submission is closed');
  const mine = await hit(decklists.onRequestGet as Handler, `/decklists?popId=4242&token=${token}`, at(code));
  assert.equal(mine.json.mine.popId, '4242');
});

test('a list sent as round 1 is paired is refused, though the event read had no rounds', async () => {
  const { code, token } = await eventWithList();
  const startNow = () =>
    db.raw.prepare("UPDATE tournaments SET state = json_set(state, '$.startedAt', 1) WHERE code = ?").run(code);
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO decklists', startNow);
  const replaced = await submit(code, { token, deck: '60 Basic {G} Energy SVE 1' });
  assert.deepEqual([replaced.status, replaced.json.error], [403, 'Decklists are locked once round 1 is paired']);
  env.TOURNAMENT_DB = db;
  const mine = await hit(decklists.onRequestGet as Handler, `/decklists?popId=4242&token=${token}`, at(code));
  assert.equal(mine.json.mine.deck, LIST.deck, 'the list stands as it was');
  assert.equal((await withdraw(code, token)).status, 403);
});

/** Closes submission for the event straight in the database, as a close landing mid-request would. */
const closeNow = (code: string) => () =>
  db.raw
    .prepare("UPDATE tournaments SET settings = json_set(settings, '$.decklists', 'closed') WHERE code = ?")
    .run(code);

const readMine = (code: string, token: string) =>
  hit(decklists.onRequestGet as Handler, `/decklists?popId=4242&token=${token}`, at(code));

test('a list sent or withdrawn as submission closes is refused, though the event read had it open', async () => {
  const { code, token } = await eventWithList();
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO decklists', closeNow(code));
  const replaced = await submit(code, { token, deck: '60 Basic {G} Energy SVE 1' });
  assert.deepEqual([replaced.status, replaced.json.error], [403, 'Decklist submission is closed']);
  assert.equal((await readMine(code, token)).json.mine.deck, LIST.deck, 'the list stands as it was');

  db.raw
    .prepare("UPDATE tournaments SET settings = json_set(settings, '$.decklists', 'open') WHERE code = ?")
    .run(code);
  env.TOURNAMENT_DB = racing(db, 'DELETE FROM decklists', closeNow(code));
  const gone = await withdraw(code, token);
  assert.deepEqual([gone.status, gone.json.error], [403, 'Decklist submission is closed']);
  assert.equal((await readMine(code, token)).json.mine.deck, LIST.deck, 'and is not withdrawn');
});

test('an event stored with the old open switch still takes lists', async () => {
  const { code, token } = await eventWithList();
  db.raw
    .prepare(
      "UPDATE tournaments SET settings = json_set(json_remove(settings, '$.decklists'), '$.decklistsOpen', json('true')) " +
        'WHERE code = ?'
    )
    .run(code);
  const replaced = await submit(code, { token, deck: '60 Basic {G} Energy SVE 1' });
  assert.equal(replaced.status, 200);
  assert.equal((await readMine(code, token)).json.mine.deck, '60 Basic {G} Energy SVE 1');
});

const record = (code: string, cookie: string | undefined, body: Record<string, unknown>) =>
  hit(deckChecks.onRequestPost as Handler, '/deck-checks', at(code), { method: 'POST', cookie, body });

const readChecks = (code: string, cookie?: string, query = '') =>
  hit(deckChecks.onRequestGet as Handler, `/deck-checks${query}`, at(code), { cookie });

const entriesOf = (response: { json: { entries: DeckCheckEntry[] } }) => response.json.entries;

/** An event in round 1, with its organizer and a staff member who joined by the invite link. */
async function runningEvent() {
  const { owner, code } = await eventWithList();
  const { staffToken } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const helper = await signIn('Helper');
  await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: staffToken }
  });
  await pair(code, owner);
  const ids = async (cookie: string) => (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user;
  return { owner, helper, code, ownerId: (await ids(owner)).id as string, helperUser: await ids(helper) };
}

test('only staff read and record deck checks', async () => {
  const { code, helper, ownerId } = await runningEvent();
  const player = await signIn('Player');
  assert.equal((await readChecks(code)).status, 401);
  assert.equal((await readChecks(code, player)).status, 403);
  const check = { playerId: '4242', round: 1, checkerId: ownerId, result: 'pass' };
  assert.equal((await record(code, undefined, check)).status, 401);
  assert.equal((await record(code, player, check)).status, 403);
  const recorded = await record(code, helper, check);
  assert.equal(recorded.status, 200, 'staff who joined by the link record checks');
  const [entry] = entriesOf(recorded);
  assert.deepEqual(
    [entry?.playerName, entry?.round, entry?.checker.id, entry?.result, entry?.recordedBy, entry?.removed],
    ['Nia Okafor', 1, ownerId, 'pass', 'helper', false]
  );
  const names = (await readChecks(code, helper)).json.checkers.map((c: { name: string }) => c.name);
  assert.deepEqual(names.sort(), ['helper', 'organizer'], 'the organizer and the staff may be named as checkers');
});

test('a deck check fits the event: its player, a round paired for them, and its staff or a typed name', async () => {
  const { code, owner, ownerId } = await runningEvent();
  const stranger = await signIn('Stranger');
  const strangerId = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: stranger })).json.user.id;
  const base = {
    playerId: '4242',
    round: 1,
    checkerId: ownerId,
    result: 'fail',
    notes: 'Three Iono on the list, four in the deck.'
  };
  const refusals: [Record<string, unknown>, string][] = [
    [{ playerId: 'nobody' }, 'That player is not on this event'],
    [{ round: 2 }, 'Round 1 is the latest round paired for that player'],
    [{ round: 0 }, 'Say which round'],
    [{ result: 'maybe' }, 'Say whether it passed'],
    [{ checkerId: strangerId }, 'The checker must be on this event’s staff'],
    [{ checkerId: undefined }, 'Say who checked the deck'],
    [{ notes: 'x'.repeat(1001) }, 'Keep the notes under 1000 characters']
  ];
  for (const [change, error] of refusals) {
    const refused = await record(code, owner, { ...base, ...change });
    assert.deepEqual([refused.status, refused.json.error], [400, error], error);
  }
  const typed = await record(code, owner, { ...base, checkerId: undefined, checkerName: 'Head Judge Sam' });
  assert.deepEqual(entriesOf(typed)[0]?.checker, { id: null, name: 'Head Judge Sam' });
});

test('an edit or removal is a new entry, lands once, and every version stays', async () => {
  const { code, owner, helper, ownerId } = await runningEvent();
  const first = entriesOf(
    await record(code, owner, { playerId: '4242', round: 1, checkerId: ownerId, result: 'pass' })
  );
  const original = first[0]?.id as string;
  const edit = {
    playerId: '4242',
    round: 1,
    checkerId: ownerId,
    result: 'fail',
    notes: 'Recounted',
    replaces: original
  };
  const edited = await record(code, helper, edit);
  assert.equal(edited.status, 200);
  const again = await record(code, owner, { ...edit, notes: 'A second edit of the same version' });
  assert.equal(again.status, 409, 'two staff editing one version: the second looks again');

  const [standing] = standingChecks(entriesOf(edited));
  assert.deepEqual([standing?.result, standing?.notes, standing?.recordedBy], ['fail', 'Recounted', 'helper']);
  assert.deepEqual(
    standing?.earlier.map(entry => [entry.id, entry.result]),
    [[original, 'pass']]
  );

  const removed = await hit(deckChecks.onRequestDelete as Handler, `/deck-checks?id=${standing?.id}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(standingChecks(entriesOf(removed)), [], 'a removed check no longer stands');
  assert.equal(entriesOf(removed).length, 3, 'its versions and its removal stay on the record');
  const twice = await hit(deckChecks.onRequestDelete as Handler, `/deck-checks?id=${standing?.id}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(twice.status, 409);
  const last = entriesOf(removed).at(-1)?.id;
  assert.equal((await record(code, owner, { ...edit, replaces: last })).status, 409, 'a removal is not edited');
  assert.equal((await record(code, owner, { ...edit, replaces: 'made-up' })).status, 409);
  const unknown = await hit(deckChecks.onRequestDelete as Handler, '/deck-checks?id=made-up', at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(unknown.status, 404);
});

test('deck checks read per player, go with their event, and name no one once an account is deleted', async () => {
  const { code, owner, helper, ownerId, helperUser } = await runningEvent();
  await record(code, owner, { playerId: '4242', round: 1, checkerId: helperUser.id, result: 'pass' });
  await record(code, owner, { playerId: '900', round: 1, checkerId: ownerId, result: 'pass' });
  const one = await readChecks(code, owner, '?player=900');
  assert.deepEqual(
    entriesOf(one).map(entry => entry.playerId),
    ['900']
  );
  assert.equal(entriesOf(await readChecks(code, owner)).length, 2);

  await settle(code, owner, { finished: true });
  const gone = await hit(
    me.onRequestDelete as Handler,
    '/api/me',
    {},
    {
      method: 'DELETE',
      cookie: helper,
      body: { confirm: helperUser.handle }
    }
  );
  assert.equal(gone.status, 204);
  const after = entriesOf(await readChecks(code, owner, '?player=4242'))[0];
  assert.deepEqual(after?.checker, { id: null, name: null }, 'a deleted checker is named by no one');

  assert.equal(
    (await hit(event.onRequestDelete as Handler, '', at(code), { method: 'DELETE', cookie: owner })).status,
    204
  );
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM deck_checks').get() as { n: number }).n, 0);
});

test('a deck check whose event is deleted before it is written leaves nothing behind', async () => {
  const { code, owner, ownerId } = await runningEvent();
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO deck_checks', () => {
    db.raw.prepare('DELETE FROM tournaments WHERE code = ?').run(code);
  });
  const refused = await record(code, owner, { playerId: '4242', round: 1, checkerId: ownerId, result: 'pass' });
  env.TOURNAMENT_DB = db;
  assert.deepEqual([refused.status, refused.json.error], [404, 'No such tournament']);
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM deck_checks').get() as { n: number }).n, 0);
});
