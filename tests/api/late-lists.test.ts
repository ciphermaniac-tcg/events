/**
 * A late entrant's list on the server: sent, named and replaced in the round
 * they joined in, unlocked by staff then too, kept private until it locks,
 * and locked once the next round pairs (see decklistOpenFor).
 */

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import * as archetypes from '../../functions/api/tournaments/[code]/archetypes.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as lists from '../../functions/api/tournaments/[code]/lists.ts';
import { _forgetRules } from '../../functions/lib/tournaments/archetypeRules.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { apiSuite, type Handler } from '../__utils__/apiCalls.ts';
import { pendingResults } from '../__utils__/commands.ts';
import { at, eventCalls, PLAYER_BIRTH_YEAR } from '../__utils__/eventCalls.ts';
import { racing, type sqliteD1 } from '../__utils__/sqliteD1.ts';

const { env, hit, signIn } = apiSuite();
const { newSwiss, send, addPlayers, settle } = eventCalls(hit);

afterEach(() => {
  mock.restoreAll();
  _forgetRules();
});

const DRAGAPULT = { identifier: 'dragapult-ex', name: 'Dragapult', cards: [{ name: 'Dragapult ex', count: 2 }] };
const DUSKNOIR = {
  identifier: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  cards: [{ name: 'Dusknoir', count: 1 }]
};
const DECK = '3 Dragapult ex TWM 130\n1 Dusknoir SFA 20\n56 Basic {P} Energy SVE 5';

function serveRules(rules: unknown[]) {
  _forgetRules();
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ rules }));
}

const LENA = { popId: '7777', firstName: 'Lena', lastName: 'Late', birthDate: `02/27/${PLAYER_BIRTH_YEAR}` };
const STARTER = { popId: '900', firstName: 'Player', lastName: '0', birthDate: `02/27/${PLAYER_BIRTH_YEAR}` };

const LOCKED_LATE = 'Decklists are locked once the round after you joined is paired';

const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;

const submit = (code: string, profile: typeof LENA, deck = DECK) =>
  hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: { profile, mode: 'digital', deck }
  });

const unlock = (code: string, owner: string, popId: string) =>
  hit(decklists.onRequestPatch as Handler, `/decklists?popId=${popId}`, at(code), { method: 'PATCH', cookie: owner });

const pair = (code: string, owner: string) => send(code, owner, { type: 'pairRound', pod: 'masters' });

/** Every open match of the current round won by the first seat. */
async function finishRound(code: string, owner: string) {
  const row = await loadTournament(db(), code);
  const pod = row!.tournament.pods.find(candidate => candidate.category === 'masters')!;
  for (const command of pendingResults(pod)) {
    assert.equal((await send(code, owner, command)).status, 200);
  }
}

/** An event with open lists and archetypes in round 2, with Lena entered late during it. */
async function lateInRound2() {
  serveRules([DRAGAPULT]);
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', deckVisibility: 'always' });
  await addPlayers(code, owner, 4);
  assert.equal((await pair(code, owner)).status, 200);
  await finishRound(code, owner);
  assert.equal((await pair(code, owner)).status, 200);
  const added = await send(code, owner, {
    type: 'addPlayer',
    player: { firstName: LENA.firstName, lastName: LENA.lastName, id: LENA.popId, birthDate: LENA.birthDate }
  });
  assert.equal(added.status, 200);
  return { owner, code };
}

async function keyOf(code: string): Promise<string> {
  const view = await hit(event.onRequestGet as Handler, '/', at(code));
  const players = view.json.tournament.players as { id: string; firstName: string }[];
  return players.find(player => player.firstName === LENA.firstName)!.id;
}

const readPublic = (code: string, key: string) =>
  hit(lists.onRequestGet as Handler, `/lists?player=${encodeURIComponent(key)}`, at(code));

test('a late entrant sends and replaces their list in their round, named by its cards, and staff unlock it', async () => {
  const { owner, code } = await lateInRound2();
  const sent = await submit(code, LENA);
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.decklist.archetype, 'Dragapult');
  assert.equal(sent.json.registration, 'matched');
  assert.equal(sent.json.decklist.late, true, 'their receipt says their list locks with the round after they joined');

  assert.equal((await unlock(code, owner, LENA.popId)).status, 204, 'staff may unlock it for another device');
  const replaced = await submit(code, LENA, '60 Basic {P} Energy SVE 5');
  assert.equal(replaced.status, 200);

  const starter = await submit(code, STARTER);
  assert.deepEqual([starter.status, starter.json.error], [403, 'Decklists are locked once round 1 is paired']);
  assert.equal((await unlock(code, owner, STARTER.popId)).status, 403, 'a starter’s list stays locked for staff too');
});

test('a late entrant’s list stays private until it locks, then shows like everyone’s', async () => {
  const { owner, code } = await lateInRound2();
  assert.equal((await submit(code, LENA)).status, 200);
  const key = await keyOf(code);
  assert.equal((await readPublic(code, key)).json.list, null, 'not while they may still change it');
  assert.deepEqual((await hit(lists.onRequestGet as Handler, '/lists', at(code))).json.players, []);

  await finishRound(code, owner);
  assert.equal((await pair(code, owner)).status, 200);
  assert.deepEqual((await readPublic(code, key)).json.list, { mode: 'digital', deck: DECK });
  const late = await submit(code, LENA, '60 Basic {P} Energy SVE 5');
  assert.deepEqual([late.status, late.json.error], [403, LOCKED_LATE]);
  assert.equal((await unlock(code, owner, LENA.popId)).status, 403);

  serveRules([{ ...DRAGAPULT, variants: [DUSKNOIR] }]);
  const reread = await hit(archetypes.onRequestPost as Handler, '/archetypes', at(code), {
    method: 'POST',
    cookie: owner
  });
  assert.equal(reread.json.decks[LENA.popId], 'Dragapult Dusknoir', 'staff re-read names a late list too');
});

test('a late list sent as the next round pairs is refused, though the event read had it open', async () => {
  const { owner, code } = await lateInRound2();
  await finishRound(code, owner);
  const pairNow = () =>
    db()
      .raw.prepare(
        "UPDATE tournaments SET state = json_insert(state, '$.pods[0].rounds[#]', json_extract(state, '$.pods[0].rounds[0]')) WHERE code = ?"
      )
      .run(code);
  env.TOURNAMENT_DB = racing(db(), 'INSERT INTO decklists', pairNow);
  const sent = await submit(code, LENA);
  assert.deepEqual([sent.status, sent.json.error], [403, LOCKED_LATE]);
  env.TOURNAMENT_DB = db();
  const mine = await hit(decklists.onRequestGet as Handler, `/decklists?popId=${LENA.popId}`, at(code));
  assert.equal(mine.json.mine, null, 'nothing was stored');
});
