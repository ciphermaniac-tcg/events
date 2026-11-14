/** The TOM panel following its linked .tdf. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { follow } from '../../native/panel/src/follow';

/** File I/O whose reads finish only when the test says so. */
function slowIo(files: Record<string, string>) {
  const pending: (() => void)[] = [];
  return {
    io: {
      modified: async () => 1,
      read: (path: string) =>
        new Promise<string>(resolve => {
          pending.push(() => resolve(files[path] ?? ''));
        })
    },
    /** Lets every read under way start, then finishes them all. */
    finish: async () => {
      await new Promise(resolve => {
        setImmediate(resolve);
      });
      pending.splice(0).forEach(done => done());
    }
  };
}

test('a read of a file no longer followed lands nowhere, so a newly linked file never shows its contents', async () => {
  const { io, finish } = slowIo({ 'a.tdf': 'A', 'b.tdf': 'B' });
  const taken: string[] = [];
  const a = follow(
    'a.tdf',
    io,
    text => taken.push(text),
    () => taken.push('failed')
  );
  const reading = a.look();
  a.stop();
  const b = follow(
    'b.tdf',
    io,
    text => taken.push(text),
    () => taken.push('failed')
  );
  const next = b.look();
  await finish();
  await Promise.all([reading, next]);
  assert.deepEqual(taken, ['B']);
});

test('a followed file is read once per save, and a failed read is tried again', async () => {
  let modified = 1;
  let broken = true;
  const taken: string[] = [];
  const failures: unknown[] = [];
  const following = follow(
    'a.tdf',
    {
      modified: async () => modified,
      read: async () => {
        if (broken) {
          throw new Error('half written');
        }
        return `save ${modified}`;
      }
    },
    text => taken.push(text),
    err => failures.push(err)
  );
  await following.look();
  broken = false;
  await following.look();
  await following.look();
  modified = 2;
  await following.look();
  following.stop();
  modified = 3;
  await following.look();
  assert.equal(failures.length, 1);
  assert.deepEqual(taken, ['save 1', 'save 2']);
});
