/**
 * Registering from the event's page, beyond what the decklist suites hold.
 * What must hold: at an unsanctioned event names find the players named like
 * them, and only the device that owns a registration renames or withdraws it,
 * the event's list following; at a TOM event registrations TOM has not taken
 * in yet count toward the cap, and staff can check them in.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import * as checkins from '../../functions/api/tournaments/[code]/checkins.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as decks from '../../functions/api/tournaments/[code]/decks.ts';
import { _forgetRules } from '../../functions/lib/tournaments/archetypeRules.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import type { Player, Tournament } from '../../shared/tournament/types.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, newSwiss, settle } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
});

afterEach(() => {
  mock.restoreAll();
  _forgetRules();
});

const LIST = { deck: '60 Basic {P} Energy SVE 5', mode: 'digital' };

const register = (code: string, profile: Record<string, string>, extra: Record<string, unknown> = {}) =>
  hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: { ...LIST, profile, ...extra }
  });

const lookUp = (code: string, query: string) => hit(decklists.onRequestGet as Handler, `/decklists?${query}`, at(code));

const rosterOf = async (code: string, cookie: string) =>
  ((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie })).json.tournament as Tournament).players;

async function casualEvent() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', sanctioned: false });
  return { owner, code };
}

test('names find the players named like them, a slip away included', async () => {
  const { code } = await casualEvent();
  await register(code, { firstName: 'Avery', lastName: 'Chen' });
  await register(code, { firstName: 'Alex', lastName: 'Kim' });
  await register(code, { firstName: 'Alexa', lastName: 'Kim' });
  const slip = await lookUp(code, 'firstName=Avry&lastName=Chen');
  assert.deepEqual(slip.json.matches, [{ firstName: 'Avery', lastName: 'Chen' }]);
  assert.equal(slip.json.known, false, 'the names typed are nobody’s registration yet');
  const two = await lookUp(code, 'firstName=Alex&lastName=Kim');
  assert.equal(two.json.matches.length, 2);
  assert.equal(two.json.known, true);
});

test('only the device that owns an unsanctioned registration renames or withdraws it', async () => {
  const { owner, code } = await casualEvent();
  const sent = await register(code, { firstName: 'Grace', lastName: 'Hopper' });
  const { token } = sent.json;
  const was = { firstName: 'Grace', lastName: 'Hopper' };
  const stolen = await register(code, { firstName: 'Ada', lastName: 'Hopper' }, { was });
  assert.equal(stolen.status, 409, 'another device cannot rename it');

  const renamed = await register(code, { firstName: 'Grace B.', lastName: 'Hopper' }, { was, token });
  assert.deepEqual([renamed.status, renamed.json.registration], [200, 'matched']);
  assert.deepEqual(
    (await rosterOf(code, owner)).map(player => player.firstName),
    ['Grace B.'],
    'the event’s list takes the new name, and nobody new is added'
  );
  const staffLists = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.deepEqual(
    staffLists.json.decklists.map((list: { firstName: string }) => list.firstName),
    ['Grace B.']
  );

  const query = 'firstName=Grace%20B.&lastName=Hopper';
  const forged = await hit(decklists.onRequestDelete as Handler, `/decklists?${query}`, at(code), { method: 'DELETE' });
  assert.equal(forged.status, 409);
  const gone = await hit(decklists.onRequestDelete as Handler, `/decklists?${query}&token=${token}`, at(code), {
    method: 'DELETE'
  });
  assert.equal(gone.status, 204);
  assert.deepEqual(await rosterOf(code, owner), []);
});

function tomFile(ids: string[]): Tournament {
  const players = ids.map((id): Player => ({
    id,
    firstName: 'Tom',
    lastName: id,
    birthDate: '02/27/1990',
    droppedAfter: null,
    created: '',
    modified: ''
  }));
  return { ...emptyTournament({ name: 'League Cup', startDate: '10/10/2026' }), players };
}

test('at a TOM event a registration TOM has not taken in counts toward the cap, and staff check it in', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newEvent(owner, { mode: 'tom', tournament: tomFile(['7200001']) });
  await settle(code, owner, { decklists: 'open', playerCap: 2 });
  const nia = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
  const sent = await register(code, nia);
  assert.deepEqual([sent.status, sent.json.registration], [200, 'not-added'], 'TOM keeps its own list');
  const late = await register(code, { ...nia, popId: '4243' });
  assert.deepEqual([late.status, late.json.error], [403, 'This event is full.']);

  const ticked = await hit(checkins.onRequestPut as Handler, '/checkins', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: '4242', mark: 'tom', on: true }
  });
  assert.equal(ticked.status, 200);
  const held = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.deepEqual(held.json.checkins, { '4242': { tom: true } });
});

test('a pasted list is named by its cards, a paper one is not, and the name staff give wins', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json([{ label: 'Dragapult', deckCount: 9, signatureCards: [{ name: 'Dragapult ex', pct: 100 }] }])
  );
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', deckVisibility: 'always' });
  const nia = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
  const deckOf = async () =>
    (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json.decks['4242'];
  const sent = await register(code, nia, { deck: '4 Dragapult ex TWM 130\n56 Basic {P} Energy SVE 5' });
  assert.equal(sent.json.decklist.archetype, 'Dragapult');
  assert.equal(await deckOf(), 'Dragapult');
  await register(code, nia, { mode: 'paper', deck: '' });
  assert.equal(await deckOf(), undefined, 'a paper list says nothing of its deck');

  await register(code, nia);
  await hit(decks.onRequestPut as Handler, '/decks', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: '4242', archetype: 'Rogue' }
  });
  await register(code, nia, { deck: '4 Dragapult ex TWM 130\n56 Basic {P} Energy SVE 5' });
  assert.equal(await deckOf(), 'Rogue', 'staff’s name stays through the player’s changes');
});
