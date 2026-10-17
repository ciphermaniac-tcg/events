/**
 * Staff check-in before round 1. What must hold: only staff tick a check,
 * and only for a player the event knows; round 1 is refused while a check
 * the event asks for is open (a fee unpaid, a paper list not in), and pairs
 * once each is ticked or the player dropped; an event that asks nothing pairs
 * as it always did.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as checkins from '../../functions/api/tournaments/[code]/checkins.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
});

const tick = (code: string, cookie: string, body: Record<string, unknown>) =>
  hit(checkins.onRequestPut as Handler, '/checkins', at(code), { method: 'PUT', cookie, body });

const pair = (code: string, cookie: string) => send(code, cookie, { type: 'pairRound', pod: 'masters' });

async function paidEvent() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 5);
  assert.equal((await settle(code, owner, { entryFee: 10 })).status, 200);
  return { owner, code };
}

test('round 1 waits on every fee, and pairs once each is paid or its player dropped', async () => {
  const { owner, code } = await paidEvent();
  const refused = await pair(code, owner);
  assert.deepEqual([refused.status, refused.json.error], [400, '5 players aren’t checked in.']);

  for (const id of ['900', '901', '902', '903']) {
    assert.equal((await tick(code, owner, { playerId: id, mark: 'paid', on: true })).status, 200);
  }
  assert.equal((await pair(code, owner)).json.error, '1 player isn’t checked in.');
  assert.equal((await send(code, owner, { type: 'dropPlayer', id: '904' })).status, 200);
  assert.equal((await pair(code, owner)).status, 200, 'a dropped player is not waited on');
});

test('a cleared check opens again, and the console holds what staff checked', async () => {
  const { owner, code } = await paidEvent();
  await tick(code, owner, { playerId: '900', mark: 'paid', on: true });
  await tick(code, owner, { playerId: '901', mark: 'paid', on: true });
  await tick(code, owner, { playerId: '901', mark: 'paid', on: false });
  const held = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.deepEqual(held.json.checkins, { '900': { paid: true } });
});

test('a free event the site pairs asks for nothing', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  assert.equal((await pair(code, owner)).status, 200);
});

test('only staff tick a check, and only a known player’s or a known check', async () => {
  const { owner, code } = await paidEvent();
  const stranger = await signIn('Stranger');
  assert.equal((await tick(code, stranger, { playerId: '900', mark: 'paid', on: true })).status, 403);
  assert.equal((await tick(code, owner, { playerId: '999', mark: 'paid', on: true })).status, 400);
  assert.equal((await tick(code, owner, { playerId: '900', mark: 'vip', on: true })).status, 400);
  assert.equal((await tick(code, owner, { playerId: '900', mark: 'paper', on: true })).status, 400);
});
