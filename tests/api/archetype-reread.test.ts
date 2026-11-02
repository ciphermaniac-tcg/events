/**
 * Staff name every pasted list again by the archetype rules as they stand
 * now, keeping the names staff gave and the names of lists with no cards.
 */

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import * as archetypes from '../../functions/api/tournaments/[code]/archetypes.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as decks from '../../functions/api/tournaments/[code]/decks.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import { _forgetRules } from '../../functions/lib/tournaments/archetypeRules.ts';
import { apiSuite, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import type { sqliteD1 } from '../__utils__/sqliteD1.ts';

const { env, hit, signIn } = apiSuite(decklists);
const { newSwiss, settle, joinStaff } = eventCalls(hit);

afterEach(() => {
  mock.restoreAll();
  _forgetRules();
});

const DRAGAPULT = {
  identifier: 'dragapult-ex',
  name: 'Dragapult',
  priority: 11,
  cards: [{ name: 'Dragapult ex', count: 2 }]
};
const DUSKNOIR = {
  identifier: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  cards: [{ name: 'Dusknoir', count: 1 }]
};
const DECK = '3 Dragapult ex TWM 130\n1 Dusknoir SFA 20\n56 Basic {P} Energy SVE 5';

/** Answers every read of the rules with `rules`, read afresh. */
function serveRules(rules: unknown[]) {
  _forgetRules();
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ rules }));
}

const NIA = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
const OMAR = { popId: '5151', firstName: 'Omar', lastName: 'Diaz', birthDate: '03/14/1999' };
const ZOE = { popId: '6161', firstName: 'Zoe', lastName: 'Park', birthDate: '05/01/1998' };

const register = (code: string, profile: typeof NIA, body: Record<string, unknown>) =>
  hit(decklists.onRequestPut as Handler, '/decklists', at(code), { method: 'PUT', body: { profile, ...body } });

const reread = (code: string, cookie: string) =>
  hit(archetypes.onRequestPost as Handler, '/archetypes', at(code), { method: 'POST', cookie });

/** An event with archetypes on, and three lists named by the plain Dragapult rule: Nia's and Zoe's pasted, Omar's on paper. */
async function eventWithLists() {
  serveRules([DRAGAPULT]);
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', deckVisibility: 'always' });
  assert.equal((await register(code, NIA, { mode: 'digital', deck: DECK })).json.decklist.archetype, 'Dragapult');
  await register(code, ZOE, { mode: 'digital', deck: DECK });
  await register(code, OMAR, { mode: 'paper', deck: '' });
  // Staff named Zoe's deck themselves.
  await hit(decks.onRequestPut as Handler, '/decks', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: ZOE.popId, archetype: 'Rogue' }
  });
  return { owner, code };
}

const decksOf = async (code: string, owner: string) =>
  (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json.decks as Record<
    string,
    string
  >;

const listNames = async (code: string, owner: string) =>
  Object.fromEntries(
    (
      (await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner })).json.decklists as {
        popId: string;
        archetype: string | null;
      }[]
    ).map(list => [list.popId, list.archetype])
  );

test('re-reading names each pasted list by the rules as they stand now, and staff’s names stay', async () => {
  const { owner, code } = await eventWithLists();
  serveRules([{ ...DRAGAPULT, variants: [DUSKNOIR] }]);
  const answer = await reread(code, owner);
  assert.equal(answer.status, 200);
  assert.equal(answer.json.renamed, 2, 'Nia’s and Zoe’s lists');
  assert.equal(answer.json.decks[NIA.popId], 'Dragapult Dusknoir');
  assert.equal(answer.json.decks[ZOE.popId], 'Rogue', 'the name staff gave wins');
  assert.equal(answer.json.decks[OMAR.popId], undefined, 'a paper list says nothing of its deck');
  assert.deepEqual(await listNames(code, owner), {
    [NIA.popId]: 'Dragapult Dusknoir',
    [ZOE.popId]: 'Dragapult Dusknoir',
    [OMAR.popId]: null
  });

  const again = await reread(code, owner);
  assert.deepEqual([again.status, again.json.renamed], [200, 0], 'nothing left to rename');
});

test('a list whose cards went as the event ended keeps its name', async () => {
  const { owner, code } = await eventWithLists();
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  // What store.ts leaves of a minor's list once the event ends: the name, no cards.
  db.raw.prepare("UPDATE decklists SET deck = '' WHERE code = ? AND pop_id = ?").run(code, NIA.popId);
  serveRules([{ ...DRAGAPULT, variants: [DUSKNOIR] }]);
  const answer = await reread(code, owner);
  assert.equal(answer.json.renamed, 1, 'only Zoe’s');
  assert.equal(answer.json.decks[NIA.popId], 'Dragapult');
  assert.equal((await listNames(code, owner))[NIA.popId], 'Dragapult');
});

test('re-reading is for staff, at an event with archetypes, with rules to read', async () => {
  const { owner, code } = await eventWithLists();
  const stranger = await signIn('Stranger');
  assert.equal((await reread(code, stranger)).status, 403);
  assert.equal((await reread(code, '')).status, 401);
  const helper = await signIn('Helper');
  await joinStaff(code, owner, helper);
  assert.equal((await reread(code, helper)).status, 200, 'any of its staff');

  serveRules([]);
  const unread = await reread(code, owner);
  assert.deepEqual([unread.status, unread.json.error], [503, 'Couldn’t read the archetype rules. Try again later.']);
  assert.equal((await decksOf(code, owner))[NIA.popId], 'Dragapult', 'and no list loses its name');

  await settle(code, owner, { deckVisibility: 'off' });
  const off = await reread(code, owner);
  assert.deepEqual([off.status, off.json.error], [400, 'Archetypes are off for this event']);
});
