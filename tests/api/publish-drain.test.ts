/**
 * Within one isolate an event publishes one copy at a time: rows that come
 * while one is going up wait, the newest taking an older one's place, so a
 * burst builds and uploads its first row and its newest, not every one.
 */

import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { publicViewOf } from '../../functions/lib/tournaments/access.ts';
import { publishView } from '../../functions/lib/tournaments/publish.ts';
import { loadTournament, type TournamentRow } from '../../functions/lib/tournaments/store.ts';
import type { PublishBucket, PublishedObject } from '../../functions/lib/types.ts';
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

test('a row builds its public view once, for the copy it publishes and the answer that carries it', async () => {
  const row = await eventRow();
  const view = publicViewOf(row);
  assert.equal(publicViewOf(row), view);
  assert.notEqual(publicViewOf({ ...row }), view, 'another row builds its own');
  assert.deepEqual(publicViewOf({ ...row }), view);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Conditional writes are checked when they land, including a put released after takeover. */
function stalledBucket(operation: 'head' | 'put') {
  let held: PublishedObject | null = null;
  let heads = 0;
  const calls: string[] = [];
  const old = deferred<null>();
  const next = deferred<void>();
  const nextStarted = deferred<void>();
  const bucket: PublishBucket = {
    head: async () => {
      calls.push('head');
      heads += 1;
      return heads === 1 && operation === 'head' ? old.promise : held;
    },
    put: async (_key, _body, options) => {
      const { version } = options.customMetadata;
      calls.push(`put ${version}`);
      if (version === '2' && operation === 'put') {
        await old.promise;
      }
      if (version === '6') {
        nextStarted.resolve();
        await next.promise;
      }
      const condition = options.onlyIf;
      const matches = condition instanceof Headers ? !held : condition?.etagMatches === held?.etag;
      if (!matches) {
        return null;
      }
      held = { etag: `etag-${version}`, customMetadata: options.customMetadata };
      return held;
    },
    delete: async () => {
      calls.push('delete');
      held = null;
    }
  };
  return { bucket, calls, old, next, nextStarted, version: () => held?.customMetadata?.version };
}

function testTakeover(operation: 'head' | 'put', outcome: 'resolve' | 'reject') {
  test(`a stalled ${operation} permits takeover and its late ${outcome} preserves the current drain`, async t => {
    const row = await eventRow();
    const held = stalledBucket(operation);
    env.EVENTS_DATA = held.bucket;
    t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
    t.mock.method(console, 'error', () => undefined);
    const at = (version: number) => publishView(env, { ...row, version });
    const first = at(2);
    // Let the first operation enter R2 before offering more rows.
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    assert.deepEqual(held.calls, operation === 'head' ? ['head'] : ['head', 'put 2']);
    const waiting = at(5);
    t.mock.timers.tick(19_999);
    assert.equal(at(3), first, 'coalesces before the threshold');
    t.mock.timers.tick(1);
    await at(4);
    assert.equal(held.version(), '5', 'takeover carries the newest previously offered row');
    assert.ok(held.calls.includes('put 5'), 'fresh head/put proceeds while the first operation is hung');

    const current = at(6);
    await held.nextStarted.promise;
    if (outcome === 'resolve') {
      held.old.resolve(null);
    } else {
      held.old.reject(new Error('late R2 failure'));
    }
    await Promise.all([first, waiting]);
    assert.equal(held.version(), '5', 'the old operation cannot overwrite or delete the newer copy');
    assert.ok(!held.calls.includes('delete'));
    const newest = at(7);
    assert.equal(newest, current, 'old finally cannot remove the replacement drain');
    held.next.resolve();
    await Promise.all([current, newest]);
    assert.equal(held.version(), '7');
    assert.equal(held.calls.filter(call => call === 'put 7').length, 1);
  });
}

for (const operation of ['head', 'put'] as const) {
  for (const outcome of ['resolve', 'reject'] as const) {
    testTakeover(operation, outcome);
  }
}

test('takeover waits for an already issued unconditional cleanup delete', async t => {
  const row = await eventRow();
  const held = heldBucket();
  const deleting = deferred<void>();
  const deleted = deferred<void>();
  let fail = true;
  env.EVENTS_DATA = {
    ...held.bucket,
    head: async key => {
      if (fail) {
        fail = false;
        throw new Error('R2 head failed');
      }
      return held.bucket.head(key);
    },
    delete: async key => {
      deleting.resolve();
      await deleted.promise;
      return held.bucket.delete(key);
    }
  };
  t.mock.method(console, 'error', () => undefined);
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const first = publishView(env, { ...row, version: 2 });
  await deleting.promise;
  t.mock.timers.tick(20_001);
  const later = publishView(env, { ...row, version: 3 });
  assert.equal(later, first, 'no newer copy can land while the unconditional delete is outstanding');
  assert.deepEqual(held.calls, []);
  deleted.resolve();
  await held.release();
  await Promise.all([first, later]);
  assert.deepEqual(held.calls, ['delete', 'head', 'put 3']);
  assert.equal(held.version(), '3');
});
