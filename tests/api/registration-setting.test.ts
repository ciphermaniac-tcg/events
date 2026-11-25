/**
 * Online registration as a setting of its own, apart from Decklists. What
 * must hold: a new event registers players on its page with no list, and
 * refuses a list until Decklists is on; with registration off nobody
 * registers or withdraws there, whatever Decklists was last set to, though
 * staff still add players; an event stored before the setting existed
 * registers players exactly while it takes lists; and a registration with no
 * list is never asked for one.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { resetRateLimiters } from '../../functions/lib/api/rateLimiter.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, view } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
  resetRateLimiters();
});

const PROFILE = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
const DECK = '60 Basic {P} Energy SVE 5';

const register = (code: string, body: Record<string, unknown> = {}) =>
  hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: { profile: PROFILE, ...body }
  });

const withdraw = (code: string) =>
  hit(decklists.onRequestDelete as Handler, '/decklists?popId=4242&birthYear=2001', at(code), { method: 'DELETE' });

async function newEvent() {
  const owner = await signIn('Organizer', 'organizer');
  return { owner, code: await newSwiss(owner) };
}

/** The event's settings as stored before registration was a setting: none of it, and `lists` for Decklists. */
const storeLegacy = (code: string, lists: string) =>
  db.raw
    .prepare(
      "UPDATE tournaments SET settings = json_set(json_remove(settings, '$.registration'), '$.decklists', ?) WHERE code = ?"
    )
    .run(lists, code);

test('a new event registers players online with no list, and takes none until Decklists is on', async () => {
  const { owner, code } = await newEvent();
  const { settings } = await view(code);
  assert.deepEqual([settings.registration, settings.decklists], [true, 'off']);
  assert.equal(settings.deckVisibility, 'after', 'and shows archetypes once it ends');

  const listed = await register(code, { deck: DECK });
  assert.deepEqual([listed.status, listed.json.error], [403, 'This event does not take decklists']);
  assert.equal((await view(code)).tournament.players.length, 0, 'a refused list registers nobody');

  const sent = await register(code);
  assert.equal(sent.status, 200);
  assert.deepEqual(
    [sent.json.registration, sent.json.decklist.deck, sent.json.decklist.registered],
    ['added', '', true]
  );
  assert.deepEqual(
    (await view(code)).tournament.players.map(player => player.firstName),
    ['Nia'],
    'they are on the roster as any online registrant is'
  );

  // Nothing asks them for a list: round 1 pairs without a List received check.
  await addPlayers(code, owner, 3);
  assert.equal((await send(code, owner, { type: 'pairRound', pod: 'masters' })).status, 200);
  const late = await register(code, { profile: { ...PROFILE, popId: '5151' } });
  assert.deepEqual(
    [late.status, late.json.error],
    [403, 'Registration closed when round 1 was paired.'],
    'registration still closes as round 1 pairs'
  );
});

test('a registration with no list withdraws, and takes a list once Decklists is on', async () => {
  const { owner, code } = await newEvent();
  assert.equal((await register(code)).status, 200);
  assert.equal((await withdraw(code)).status, 204);
  assert.equal((await view(code)).tournament.players.length, 0);

  const again = await register(code);
  await settle(code, owner, { decklists: 'closed' });
  const listed = await register(code, { deck: DECK, token: again.json.token });
  assert.deepEqual([listed.status, listed.json.decklist.deck], [200, DECK]);
  assert.equal((await register(code, { deck: '', mode: 'digital' })).status, 400, 'a list is asked for again');
});

test('with registration off nobody registers online, whatever Decklists was, and staff still add players', async () => {
  const { owner, code } = await newEvent();
  await settle(code, owner, { decklists: 'closed' });
  assert.equal((await register(code, { deck: DECK })).status, 200);
  assert.equal((await settle(code, owner, { registration: false })).status, 200);

  const { settings } = await view(code);
  assert.deepEqual([settings.registration, settings.decklists], [false, 'off'], 'no lists are taken either');
  for (const body of [{}, { deck: DECK }, { mode: 'paper' }]) {
    const refused = await register(code, { ...body, profile: { ...PROFILE, popId: '5151' } });
    assert.deepEqual([refused.status, refused.json.error], [403, 'Register with the organizer.']);
  }
  const gone = await withdraw(code);
  assert.deepEqual([gone.status, gone.json.error], [403, 'Register with the organizer.']);
  await addPlayers(code, owner, 2);
  assert.equal((await view(code)).tournament.players.length, 3);

  // Decklists is not chosen while registration is off, and comes back with it.
  await settle(code, owner, { registration: true });
  assert.equal((await view(code)).settings.decklists, 'off');
  assert.equal((await register(code, { profile: { ...PROFILE, popId: '5151' } })).status, 200);
});

test('an event stored before registration was a setting registers players exactly while it takes lists', async () => {
  const { code } = await newEvent();

  storeLegacy(code, 'off');
  assert.equal((await loadTournament(db, code))?.settings.registration, false);
  const off = await register(code);
  assert.deepEqual([off.status, off.json.error], [403, 'Register with the organizer.']);
  assert.equal((await register(code, { deck: DECK })).status, 403);

  for (const lists of ['closed', 'open']) {
    storeLegacy(code, lists);
    const settings = (await loadTournament(db, code))?.settings;
    assert.deepEqual([settings?.registration, settings?.decklists], [true, lists]);
    assert.equal(
      (await register(code, { deck: '', mode: 'digital' })).status,
      400,
      'a digital list is still asked for'
    );
    const sent = await register(code, { deck: DECK });
    assert.deepEqual([sent.status, sent.json.decklist.deck], [200, DECK]);
    assert.equal((await register(code, { mode: 'paper', token: sent.json.token })).status, 200);
    assert.equal((await withdraw(code)).status, 204);
  }
});

test('a registration landing as registration turns off is refused, though the event read had it on', async () => {
  const { code } = await newEvent();
  const closeNow = () =>
    db.raw
      .prepare("UPDATE tournaments SET settings = json_set(settings, '$.registration', json('false')) WHERE code = ?")
      .run(code);
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO decklists', closeNow);
  const sent = await register(code);
  assert.deepEqual([sent.status, sent.json.error], [403, 'Register with the organizer.']);
  const stored = db.raw.prepare('SELECT count(*) AS n FROM decklists WHERE code = ?').get(code) as { n: number };
  assert.equal(stored.n, 0);
});

test('an edit while Decklists is off leaves the list already in as it was, and takes no new one', async () => {
  const { owner, code } = await newEvent();
  await settle(code, owner, { decklists: 'closed' });
  const sent = await register(code, { deck: DECK });
  db.raw.prepare("UPDATE decklists SET archetype = 'Iono Box' WHERE code = ?").run(code);
  await settle(code, owner, { decklists: 'off' });

  // The form sends no list with Decklists off, as for a paper one.
  const renamed = await register(code, {
    profile: { ...PROFILE, firstName: 'Nina' },
    mode: 'paper',
    deck: '',
    token: sent.json.token
  });
  assert.equal(renamed.status, 200);
  assert.deepEqual([renamed.json.decklist.mode, renamed.json.decklist.deck], ['digital', DECK]);
  const stored = () =>
    db.raw
      .prepare('SELECT first_name AS name, deck_mode AS mode, deck, archetype FROM decklists WHERE code = ?')
      .get(code);
  assert.deepEqual({ ...stored() }, { name: 'Nina', mode: 'digital', deck: DECK, archetype: 'Iono Box' });

  const listed = await register(code, { deck: '4 Iono PAL 185', token: sent.json.token });
  assert.deepEqual([listed.status, listed.json.error], [403, 'This event does not take decklists']);
  assert.equal(stored()?.deck, DECK);
});
