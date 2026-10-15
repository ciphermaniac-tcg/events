/**
 * Within one isolate an event publishes one copy at a time: rows that come
 * while one is going up wait, the newest taking an older one's place, so a
 * burst builds and uploads its first row and its newest, not every one.
 */

import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { publishView } from '../../functions/lib/tournaments/publish.ts';
import { loadTournament, type TournamentRow } from '../../functions/lib/tournaments/store.ts';
import type { PublishBucket } from '../../functions/lib/types.ts';
import { apiCalls } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

/** A bucket holding one copy, that logs each call and holds each put until `release` lets it through. */
function heldBucket() {
  let held: { version: string; etag: string } | null = null;
  const calls: string[] = [];
  const gates: (() => void)[] = [];
  const bucket: PublishBucket = {
    head: async () => {
      calls.push('head');
      return held && { etag: held.etag, customMetadata: { version: held.version } };
    },
    put: async (_key, _body, options) => {
      const version = options.customMetadata.version ?? '';
      calls.push(`put ${version}`);
      await new Promise<void>(resolve => {
        gates.push(resolve);
      });
      held = { version, etag: `etag-${version}` };
      return { etag: held.etag };
    },
    delete: async () => {
      calls.push('delete');
      held = null;
    }
  };
  /** Lets the put waiting longest through, once there is one. */
  const release = async () => {
    while (gates.length === 0) {
      await new Promise(resolve => {
        setImmediate(resolve);
      });
    }
    gates.shift()?.();
  };
  return { bucket, calls, release, version: () => held?.version };
}

async function eventRow(): Promise<TournamentRow> {
  const code = await newSwiss(await signIn('Organizer', 'organizer'));
  const row = await loadTournament(db, code);
  assert.ok(row);
  return row;
}

test('a burst puts up the row it started with and then only the newest that came meanwhile', async () => {
  const row = await eventRow();
  const { bucket, calls, release, version } = heldBucket();
  env.EVENTS_DATA = bucket;
  const at = (v: number) => publishView(env, { ...row, version: v });
  const first = at(2);
  const rest = [at(3), at(5), at(4)];
  await release();
  await release();
  await Promise.all([first, ...rest]);
  assert.deepEqual(calls, ['head', 'put 2', 'head', 'put 5']);
  assert.equal(version(), '5');
  // Done with the burst, the next row starts afresh.
  const next = at(6);
  await release();
  await next;
  assert.deepEqual(calls.slice(4), ['head', 'put 6']);
});

test('a row no newer than one already taken is not published again', async () => {
  const row = await eventRow();
  const { bucket, calls, release } = heldBucket();
  env.EVENTS_DATA = bucket;
  const first = publishView(env, { ...row, version: 3 });
  const same = publishView(env, { ...row, version: 3 });
  const older = publishView(env, { ...row, version: 2 });
  await release();
  await Promise.all([first, same, older]);
  assert.deepEqual(calls, ['head', 'put 3']);
});

test('a publish that fails takes its copy down and still lets the newest waiting row go up', async () => {
  const row = await eventRow();
  const { bucket, calls, release, version } = heldBucket();
  let failed = false;
  env.EVENTS_DATA = {
    ...bucket,
    put: async (key, body, options) => {
      if (!failed) {
        failed = true;
        calls.push('put failed');
        throw new Error('R2 is down');
      }
      return bucket.put(key, body, options);
    }
  };
  const log = mock.method(console, 'error', () => undefined);
  try {
    const first = publishView(env, { ...row, version: 2 });
    const later = publishView(env, { ...row, version: 3 });
    await release();
    await Promise.all([first, later]);
  } finally {
    log.mock.restore();
  }
  assert.deepEqual(calls, ['head', 'put failed', 'delete', 'head', 'put 3']);
  assert.equal(version(), '3');
});
