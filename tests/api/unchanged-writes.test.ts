/**
 * A setting, a display preset or a deck saved again as it already stands
 * writes nothing: no new version for every console and page to reload, and
 * nothing published. An idle event is the exception, since any change from
 * staff ends idleness, and a real change still writes and publishes.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as decks from '../../functions/api/tournaments/[code]/decks.ts';
import * as display from '../../functions/api/tournaments/[code]/display.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import type { PublishBucket } from '../../functions/lib/types.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
let published: { heads: number; puts: number };
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, addPlayers, settle } = eventCalls(hit);

/** A bucket that holds nothing and counts what is asked of it. */
function countingBucket(): PublishBucket {
  return {
    head: async () => {
      published.heads += 1;
      return null;
    },
    put: async () => {
      published.puts += 1;
      return { etag: String(published.puts) };
    },
    delete: async () => undefined
  };
}

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  published = { heads: 0, puts: 0 };
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true', EVENTS_DATA: countingBucket() };
});

const stamp = async (code: string) => {
  const row = await loadTournament(db, code);
  return [row?.version, row?.updatedAt];
};

/** Runs `change`, and says whether it wrote a version or published anything. */
async function wrote(code: string, change: () => Promise<{ status: number }>) {
  const before = { stamp: await stamp(code), ...published };
  assert.equal((await change()).status, 200);
  const after = await stamp(code);
  return {
    version: after[0] !== before.stamp[0],
    updatedAt: after[1] !== before.stamp[1],
    published: published.heads + published.puts > before.heads + before.puts
  };
}

const NOTHING = { version: false, updatedAt: false, published: false };
const SOMETHING = { version: true, updatedAt: true, published: true };

test('settings saved again as they stand write and publish nothing; a real change does both', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  assert.deepEqual(await wrote(code, () => settle(code, owner, { playerReporting: true })), SOMETHING);
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(await wrote(code, () => settle(code, owner, { playerReporting: true })), NOTHING);
  }
  assert.deepEqual(await wrote(code, () => settle(code, owner, { format: 'Expanded' })), SOMETHING);
});

test('a deck label set again as it stands writes nothing, and clearing an absent one neither', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 1);
  const label = (archetype: string | null) => () =>
    hit(decks.onRequestPut as Handler, '/decks', at(code), {
      method: 'PUT',
      cookie: owner,
      body: { playerId: '900', archetype }
    });
  assert.deepEqual(await wrote(code, label(null)), NOTHING);
  assert.deepEqual(await wrote(code, label('Lugia VSTAR')), SOMETHING);
  assert.deepEqual(await wrote(code, label(' Lugia VSTAR ')), NOTHING, 'trimmed as it is stored');
  assert.deepEqual(await wrote(code, label(null)), SOMETHING);
});

test('no display preset picked again writes nothing', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const none = () =>
    hit(display.onRequestPut as Handler, '/display', at(code), {
      method: 'PUT',
      cookie: owner,
      body: { preset: null }
    });
  assert.deepEqual(await wrote(code, none), NOTHING);
});

test('the same setting saved at an idle event still ends idleness', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { playerReporting: true });
  db.raw
    .prepare("UPDATE tournaments SET settings = json_set(settings, '$.idle', json('true')) WHERE code = ?")
    .run(code);
  assert.deepEqual(await wrote(code, () => settle(code, owner, { playerReporting: true })), SOMETHING);
  assert.equal((await loadTournament(db, code))?.settings.idle, false);
});

test('a setting another write already saved, found on the retry, writes nothing more', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', () =>
    db.raw
      .prepare(
        "UPDATE tournaments SET settings = json_set(settings, '$.format', 'Expanded'), version = version + 1 WHERE code = ?"
      )
      .run(code)
  );
  const before = (await loadTournament(db, code))?.version ?? 0;
  const saved = await settle(code, owner, { format: 'Expanded' });
  assert.deepEqual([saved.status, saved.json.version, saved.json.settings.format], [200, before + 1, 'Expanded']);
  env.TOURNAMENT_DB = db;
  assert.equal((await loadTournament(db, code))?.version, before + 1, 'only the other write made a version');
});

/** Runs `change` once the request has read the event: another write landing between its read and its answer. */
const afterTheRead = (change: () => void) => {
  let left = 1;
  env.TOURNAMENT_DB = {
    ...db,
    batch: async statements => {
      const results = await db.batch(statements);
      if (left > 0) {
        left -= 1;
        change();
      }
      return results;
    }
  };
};

test('a setting that stood when read, changed by another write after the read, is saved after all', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { format: 'Expanded' });
  afterTheRead(() =>
    db.raw
      .prepare(
        "UPDATE tournaments SET settings = json_set(settings, '$.format', 'Standard'), version = version + 1 WHERE code = ?"
      )
      .run(code)
  );
  const saved = await settle(code, owner, { format: 'Expanded' });
  env.TOURNAMENT_DB = db;
  assert.deepEqual([saved.status, saved.json.settings.format], [200, 'Expanded']);
  assert.equal((await loadTournament(db, code))?.settings.format, 'Expanded', 'stored as answered');
});

test('a setting saved again by an organizer moved down meanwhile is answered as staff', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { format: 'Expanded' });
  const before = await stamp(code);
  afterTheRead(() => {
    db.raw.prepare("UPDATE store_members SET role = 'staff'").run();
    db.raw.prepare("UPDATE tournaments SET staff_token = 'replaced', version = version + 1 WHERE code = ?").run(code);
  });
  const saved = await settle(code, owner, { format: 'Expanded' });
  env.TOURNAMENT_DB = db;
  assert.deepEqual([saved.status, saved.json.role, saved.json.staffToken], [200, 'staff', null]);
  const after = await stamp(code);
  assert.deepEqual([after[0], after[1]], [Number(before[0]) + 1, before[1]], 'only the other write made a version');
});
