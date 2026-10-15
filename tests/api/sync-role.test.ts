/**
 * A TOM sync answers with the console's copy as the asker stands when it
 * lands: an organizer moved down to staff while the sync was on its way, and
 * the invite link replaced, gets staff's copy, without the new link.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as sync from '../../functions/api/tournaments/[code]/sync.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { revisionOf } from '../../shared/tournament/revision.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newEvent } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

const file = (): Tournament =>
  parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));

/** A TOM event its organizer runs, and what their console holds of it. */
async function tomEvent() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newEvent(owner, { mode: 'tom', tournament: file() });
  const held = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  return { owner, code, held };
}

/** Just before the sync's write: the organizer is moved down to staff, and the invite link replaced. */
function demotedMeanwhile(code: string) {
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', () => {
    db.raw.prepare("UPDATE store_members SET role = 'staff'").run();
    db.raw.prepare("UPDATE tournaments SET staff_token = 'replaced', version = version + 1 WHERE code = ?").run(code);
  });
}

const put = (code: string, cookie: string, body: Record<string, unknown>) =>
  hit(sync.onRequestPut as Handler, '/sync', at(code), { method: 'PUT', cookie, body });

test('a changed file synced by an organizer moved down meanwhile lands, answered as staff', async () => {
  const { owner, code, held } = await tomEvent();
  const changed = { ...held.tournament, info: { ...held.tournament.info, name: 'Renamed Challenge' } };
  demotedMeanwhile(code);
  const synced = await put(code, owner, { tournament: changed, base: await revisionOf(held.tournament) });
  env.TOURNAMENT_DB = db;
  assert.equal(synced.status, 200);
  assert.deepEqual([synced.json.role, synced.json.staffToken], ['staff', null]);
  assert.equal(synced.json.revision, await revisionOf(changed));
  assert.equal((await loadTournament(db, code))?.tournament.info.name, 'Renamed Challenge');
});

test('a file uploaded again by an organizer moved down meanwhile is imported, answered as staff', async () => {
  const { owner, code, held } = await tomEvent();
  demotedMeanwhile(code);
  const base = await revisionOf(held.tournament);
  const uploaded = await put(code, owner, { tournament: held.tournament, base, manual: true });
  env.TOURNAMENT_DB = db;
  assert.equal(uploaded.status, 200);
  assert.deepEqual([uploaded.json.role, uploaded.json.staffToken], ['staff', null]);
  assert.equal(uploaded.json.revision, base);
  assert.ok(uploaded.json.lastImportAt >= held.lastImportAt);
});

test('an organizer still in place gets the organizer’s copy, invite link included', async () => {
  const { owner, code, held } = await tomEvent();
  const uploaded = await put(code, owner, {
    tournament: held.tournament,
    base: await revisionOf(held.tournament),
    manual: true
  });
  assert.deepEqual([uploaded.json.role, uploaded.json.staffToken], ['owner', held.staffToken]);
});
