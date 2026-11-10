/**
 * Open decklists: anyone reads a player's list by their public key, once the
 * organizer opened the event's lists and round 1 is paired.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as checkins from '../../functions/api/tournaments/[code]/checkins.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as lists from '../../functions/api/tournaments/[code]/lists.ts';
import { resetRateLimiters } from '../../functions/lib/api/rateLimiter.ts';
import { apiSuite, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const { env, hit, signIn } = apiSuite();
const { newSwiss, send, addPlayers, settle } = eventCalls(hit);

const NIA = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
const OMAR = { popId: '5151', firstName: 'Omar', lastName: 'Diaz', birthDate: '03/14/1999' };
const DECK = '4 Dreepy TWM 128\n56 Basic {P} Energy SVE 5';

const submit = (code: string, profile: typeof NIA, body: Record<string, unknown>) =>
  hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: { profile, archetype: null, ...body }
  });

/** The public key the event's page knows a player by. */
async function keyOf(code: string, firstName: string): Promise<string> {
  const view = await hit(event.onRequestGet as Handler, '/', at(code));
  const players = view.json.tournament.players as { id: string; firstName: string }[];
  const found = players.find(player => player.firstName === firstName);
  assert.ok(found, `${firstName} is on the event's list`);
  return found.id;
}

const read = (code: string, player: string) =>
  hit(lists.onRequestGet as Handler, `/lists?player=${encodeURIComponent(player)}`, at(code));

/**
 * A Swiss event that took lists, Nia's pasted, Omar's on paper, and two
 * players with none; `shared` leaves decklists open, or closes them once
 * the lists are in, which keeps them private.
 */
async function eventWithLists(shared: boolean) {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  await addPlayers(code, owner, 2);
  assert.equal((await submit(code, NIA, { mode: 'digital', deck: DECK })).status, 200);
  assert.equal((await submit(code, OMAR, { mode: 'paper', deck: '' })).status, 200);
  // Staff take Omar's paper list at check-in, or round 1 won't pair.
  const handed = await hit(checkins.onRequestPut as Handler, '/checkins', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: OMAR.popId, mark: 'list', on: true }
  });
  assert.equal(handed.status, 200);
  if (!shared) {
    await settle(code, owner, { decklists: 'closed' });
  }
  return { owner, code };
}

const pair = (code: string, owner: string) => send(code, owner, { type: 'pairRound', pod: 'masters' });

test('open lists are read by public key once round 1 is paired', async () => {
  const { owner, code } = await eventWithLists(true);
  const nia = await keyOf(code, 'Nia');
  assert.notEqual(nia, NIA.popId, 'the page never names a player by Player ID');
  const early = await read(code, nia);
  assert.deepEqual([early.status, early.json.error], [404, 'This event’s lists aren’t open']);

  await pair(code, owner);
  const pasted = await read(code, nia);
  assert.equal(pasted.status, 200);
  assert.deepEqual(pasted.json.list, { mode: 'digital', deck: DECK });
  assert.equal(pasted.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await read(code, await keyOf(code, 'Omar'))).json.list, { mode: 'paper', deck: '' });
});

test('a player with no list reads as none, and a key the event lacks as no player', async () => {
  const { owner, code } = await eventWithLists(true);
  await pair(code, owner);
  const view = await hit(event.onRequestGet as Handler, '/', at(code));
  const listless = (view.json.tournament.players as { id: string; firstName: string }[]).find(
    player => !['Nia', 'Omar'].includes(player.firstName)
  );
  assert.ok(listless);
  assert.deepEqual((await read(code, listless.id)).json, { list: null });
  for (const missing of ['nobody', NIA.popId, '']) {
    const answer = await read(code, missing);
    assert.deepEqual([answer.status, answer.json.error], [404, 'No such player'], missing);
  }
});

test('anonymous list reads are limited per address, while signed-in readers are not', async () => {
  resetRateLimiters();
  const { owner, code } = await eventWithLists(true);
  await pair(code, owner);
  const address = '192.0.2.70';
  for (let i = 0; i < 1200; i += 1) {
    const read = await hit(lists.onRequestGet as Handler, '/lists', at(code), { address });
    assert.equal(read.status, 200, `read ${i + 1}`);
  }
  const limited = await hit(lists.onRequestGet as Handler, '/lists', at(code), { address });
  assert.equal(limited.status, 429);
  assert.equal(
    (await hit(lists.onRequestGet as Handler, '/lists', at(code), { address: '192.0.2.71' })).status,
    200,
    'another address has its own room'
  );
  assert.equal(
    (await hit(lists.onRequestGet as Handler, '/lists', at(code), { cookie: owner })).status,
    200,
    'a signed-in reader keeps the route'
  );
});

test('closed lists stay private after round 1', async () => {
  const { owner, code } = await eventWithLists(false);
  await pair(code, owner);
  assert.equal((await read(code, await keyOf(code, 'Nia'))).status, 404);
});

const readers = (code: string) => hit(lists.onRequestGet as Handler, '/lists', at(code));

test('the event names whose pasted list can be read, once round 1 is paired, and never a paper one', async () => {
  const { owner, code } = await eventWithLists(true);
  assert.equal((await readers(code)).status, 404, 'not before round 1');
  await pair(code, owner);
  const answer = await readers(code);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json, { players: [await keyOf(code, 'Nia')] }, 'Omar’s is on paper');
  assert.equal(answer.headers.get('Cache-Control'), 'no-store');
  (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw
    .prepare("UPDATE decklists SET deck = '' WHERE code = ? AND pop_id = ?")
    .run(code, NIA.popId);
  assert.deepEqual((await readers(code)).json, { players: [] }, 'a list whose cards went reads as none');
});

test('closed lists name nobody', async () => {
  const { owner, code } = await eventWithLists(false);
  await pair(code, owner);
  assert.equal((await readers(code)).status, 404);
});

test('an event that does not exist answers no such tournament', async () => {
  assert.equal((await read('ZZZZZZ', 'x')).status, 404);
});

test('a list whose cards went as the event ended reads as none', async () => {
  const { owner, code } = await eventWithLists(true);
  await pair(code, owner);
  // What store.ts leaves of a minor's list once the event ends.
  (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw
    .prepare("UPDATE decklists SET deck = '' WHERE code = ? AND pop_id = ?")
    .run(code, NIA.popId);
  assert.deepEqual((await read(code, await keyOf(code, 'Nia'))).json, { list: null });
});
