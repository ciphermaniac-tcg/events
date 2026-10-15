/**
 * The expiry sweeps password reset and the Clerk exchange run with each
 * request reach the rows that have run out by index, not by reading every
 * account's: what the sweeps ask is planned without a scan of their tables.
 */

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { spendClerkSession } from '../../functions/lib/auth/clerk.ts';
import { reserve, startReset } from '../../functions/lib/auth/passwordReset.ts';
import type { D1Like } from '../../functions/lib/types.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const TABLES = /clerk_sessions_used|password_resets|reset_reservations/;

test('the auth expiry sweeps scan none of their tables', async () => {
  const db = sqliteD1('tournaments.sql');
  const seen: string[] = [];
  const recording: D1Like = {
    ...db,
    prepare: sql => {
      seen.push(sql);
      return db.prepare(sql);
    }
  };
  const fetch = mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline');
  });
  const log = mock.method(console, 'error', () => undefined);
  try {
    await spendClerkSession(recording, 'sess_1');
    await reserve(recording, 'address', 'hash');
    const clerk = { publishableKey: 'pk', secretKey: 'sk', frontendApi: 'clerk.example' };
    const mail = { accountId: 'account', token: 'token', from: 'from@example.com' };
    await (
      await startReset(recording, { clerk, mail } as never, 'someone@example.com')
    ).work;
  } finally {
    fetch.mock.restore();
    log.mock.restore();
  }
  const sweeps = seen.filter(sql => sql.startsWith('DELETE') && TABLES.test(sql));
  assert.equal(sweeps.length, 3, 'each sweep ran');
  for (const sql of sweeps) {
    const plan = db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
    assert.deepEqual(
      plan.map(step => step.detail).filter(detail => detail.startsWith('SCAN')),
      [],
      sql
    );
  }
});
