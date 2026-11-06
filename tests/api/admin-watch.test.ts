/**
 * A site Admin off an event's staff reads its console as staff do, marked as
 * watching and without the invite token, and changes nothing: every write
 * still asks for a place on the event's staff.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as corrections from '../../functions/api/tournaments/[code]/corrections.ts';
import * as headJudge from '../../functions/api/tournaments/[code]/head-judge.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as players from '../../functions/api/tournaments/[code]/players.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { send, settle, runningEvent } = eventCalls(hit, signIn);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
});

const readConsole = (code: string, cookie: string) =>
  hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie });

test('an Admin off the staff reads the console as watching, without the invite token', async () => {
  const { code } = await runningEvent();
  const admin = await signIn('Watcher', 'admin');
  const read = await readConsole(code, admin);
  assert.equal(read.status, 200);
  assert.equal(read.json.watching, true);
  assert.equal(read.json.role, 'staff');
  assert.equal(read.json.staffToken, null);
  assert.equal(read.json.tournament.players.length, 4);
  for (const route of [corrections, headJudge]) {
    const answer = await hit(route.onRequestGet as Handler, '/read', at(code), { cookie: admin });
    assert.equal(answer.status, 200);
  }
});

test('the event’s own staff are never marked as watching', async () => {
  const { owner, helper, code } = await runningEvent();
  for (const cookie of [owner, helper]) {
    const read = await readConsole(code, cookie);
    assert.equal(read.status, 200);
    assert.equal(read.json.watching, undefined);
  }
});

test('an Admin watching changes nothing', async () => {
  const { owner, code } = await runningEvent();
  const admin = await signIn('Watcher', 'admin');
  const before = (await readConsole(code, owner)).json.version as number;
  const added = await send(code, admin, {
    type: 'addPlayer',
    player: { firstName: 'Late', lastName: 'Comer', id: '999', birthDate: '02/27/1990' }
  });
  assert.equal(added.status, 403);
  assert.equal((await settle(code, admin, { roundTime: 45 })).status, 403);
  // A staff GET that writes nothing still asks for a place on staff, as it did before.
  assert.equal((await hit(players.onRequestGet as Handler, '/players', at(code), { cookie: admin })).status, 403);
  assert.equal((await readConsole(code, owner)).json.version, before);
});

test('an account that is neither staff nor an Admin still cannot read the console', async () => {
  const { code } = await runningEvent();
  for (const role of [null, 'community'] as const) {
    const cookie = await signIn(`Stranger ${role ?? 'none'}`, role);
    assert.equal((await readConsole(code, cookie)).status, 403);
  }
});
