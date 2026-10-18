/**
 * An Admin's write is theirs only while they are an Admin: losing the role
 * or signing out between the request's read and its write keeps the write
 * from landing, and the request is answered as one from someone who is not
 * an Admin. A store's hand-over is its Owner's only while they own it: one
 * who lost the store meanwhile hands nobody anything, even a store left
 * with no Owner, which only an Admin mends.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as decide from '../../functions/api/admin/applications/[id].ts';
import * as organizer from '../../functions/api/admin/organizers/[id].ts';
import * as popIds from '../../functions/api/admin/pop-ids.ts';
import * as adminStores from '../../functions/api/admin/stores/index.ts';
import * as adminStore from '../../functions/api/admin/stores/[id].ts';
import * as applications from '../../functions/api/applications/index.ts';
import * as me from '../../functions/api/me.ts';
import * as members from '../../functions/api/stores/[id]/members.ts';
import * as join from '../../functions/api/stores/join.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { storeOf } = eventCalls(hit);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
  applications._resetRateLimitStore();
});

/** Runs `change` just ahead of the next statement starting with `prefix`: as if it landed between read and write. */
const meanwhile = (prefix: string, change: () => void) => {
  env.TOURNAMENT_DB = racing(db, prefix, change);
};

/** The columns of the one row `sql` reads, in order. */
const one = (sql: string, ...values: string[]) =>
  Object.values((db.raw.prepare(sql).get(...values) as Record<string, unknown> | undefined) ?? {});

const countOf = (sql: string, ...values: string[]) => one(`SELECT count(*) FROM ${sql}`, ...values)[0];

const idOf = async (cookie: string) =>
  (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user.id as string;

/** The two ways an Admin stops being one while a request of theirs is on its way, and what they are told. */
const LOSSES = [
  {
    how: 'signed out',
    status: 401,
    lose: () => db.raw.exec("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE handle = 'admin')")
  },
  {
    how: 'no longer an Admin',
    status: 403,
    lose: () => db.raw.exec("UPDATE users SET role = NULL WHERE handle = 'admin'")
  }
];

/** The Admin's cookie and a store its organizer owns, its id and its Owner's account id. */
async function adminAndStore() {
  const admin = await signIn('Admin', 'admin');
  const owner = await signIn('Owner', 'organizer');
  const store = (await storeOf(owner))!;
  return { admin, owner, store, ownerId: await idOf(owner) };
}

const actOn = (cookie: string, store: string, body: Record<string, unknown>) =>
  hit(
    adminStore.onRequestPost as Handler,
    `/api/admin/stores/${store}`,
    { id: store },
    { method: 'POST', cookie, body }
  );

/** Who is in the store, as `user_id:role`, in a stable order. */
const people = (store: string) =>
  (
    db.raw.prepare('SELECT user_id, role FROM store_members WHERE store_id = ? ORDER BY user_id').all(store) as {
      user_id: string;
      role: string;
    }[]
  ).map(row => `${row.user_id}:${row.role}`);

LOSSES.forEach(({ how, status, lose }) => {
  test(`an Admin ${how} meanwhile revokes no store`, async () => {
    const { admin, store } = await adminAndStore();
    meanwhile('UPDATE stores SET status', lose);
    assert.equal((await actOn(admin, store, { status: 'revoked' })).status, status);
    assert.deepEqual(one('SELECT status, status_by FROM stores WHERE id = ?', store), ['active', null]);
  });

  test(`an Admin ${how} meanwhile certifies no store`, async () => {
    const admin = await signIn('Admin', 'admin');
    const owner = await signIn('Reese');
    const made = await hit(
      adminStores.onRequestPost as Handler,
      '/api/admin/stores',
      {},
      {
        method: 'POST',
        cookie: admin,
        body: { owner: await idOf(owner), details: storeApplication().details, timeZone: 'America/Chicago' }
      }
    );
    assert.equal(made.status, 201);
    const store = made.json.store.id as string;
    meanwhile('UPDATE stores SET league_id', lose);
    assert.equal((await actOn(admin, store, { league: '1234567' })).status, status);
    assert.deepEqual(one('SELECT league_id FROM stores WHERE id = ?', store), [null]);
  });

  test(`an Admin ${how} meanwhile makes no store`, async () => {
    const admin = await signIn('Admin', 'admin');
    const owner = await idOf(await signIn('Reese'));
    const before = countOf('stores');
    meanwhile('INSERT INTO stores', lose);
    const made = await hit(
      adminStores.onRequestPost as Handler,
      '/api/admin/stores',
      {},
      {
        method: 'POST',
        cookie: admin,
        body: { owner, details: storeApplication().details, timeZone: 'America/Chicago' }
      }
    );
    assert.equal(made.status, status);
    assert.equal(countOf('stores'), before);
    assert.equal(countOf('store_members WHERE user_id = ?', owner), 0);
  });

  [
    { asked: 'manager', named: 'a Manager' },
    { asked: 'owner', named: 'the Owner' }
  ].forEach(({ asked, named }) => {
    test(`an Admin ${how} meanwhile makes nobody ${named}`, async () => {
      const { admin, store } = await adminAndStore();
      const newcomer = await idOf(await signIn('Newcomer'));
      const before = people(store);
      meanwhile('INSERT INTO store_members', lose);
      assert.equal((await actOn(admin, store, { [asked]: newcomer })).status, status);
      assert.deepEqual(people(store), before);
    });
  });

  test(`an Admin ${how} meanwhile gives an ownerless store no Owner`, async () => {
    const { admin, store, ownerId } = await adminAndStore();
    db.raw.prepare('DELETE FROM store_members WHERE user_id = ?').run(ownerId);
    const newcomer = await idOf(await signIn('Newcomer'));
    meanwhile('INSERT INTO store_members', lose);
    assert.equal((await actOn(admin, store, { owner: newcomer })).status, status);
    assert.deepEqual(people(store), []);
  });

  test(`an Admin ${how} meanwhile decides no Application and makes no store`, async () => {
    const admin = await signIn('Admin', 'admin');
    const applicant = await signIn('Applicant');
    const profile = { popId: '4321', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' };
    await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: applicant, body: profile });
    const sent = await hit(
      applications.onRequestPost as Handler,
      '/api/applications',
      {},
      {
        method: 'POST',
        cookie: applicant,
        body: { store: storeApplication('774321'), explanation: 'Pat runs a league' }
      }
    );
    assert.equal(sent.status, 201);
    const id = sent.json.application.id as string;
    const before = countOf('stores');
    meanwhile('UPDATE applications SET status', lose);
    const decided = await hit(
      decide.onRequestPost as Handler,
      `/api/admin/applications/${id}`,
      { id },
      {
        method: 'POST',
        cookie: admin,
        body: { decision: 'approve' }
      }
    );
    assert.equal(decided.status, status);
    assert.deepEqual(one('SELECT status, decided_by FROM applications WHERE id = ?', id), ['pending', null]);
    assert.equal(countOf('stores'), before);
  });

  test(`an Admin ${how} meanwhile revokes no Community organizer`, async () => {
    const admin = await signIn('Admin', 'admin');
    const community = await idOf(await signIn('Casual', 'community'));
    meanwhile('UPDATE users SET role = ?', lose);
    const set = await hit(
      organizer.onRequestPost as Handler,
      `/api/admin/organizers/${community}`,
      { id: community },
      {
        method: 'POST',
        cookie: admin,
        body: { role: 'revoked' }
      }
    );
    assert.equal(set.status, status);
    assert.deepEqual(one('SELECT role, role_by FROM users WHERE id = ?', community), ['community', null]);
  });

  ['another account', 'no one'].forEach(to => {
    test(`an Admin ${how} meanwhile moves no POP ID to ${to}`, async () => {
      const admin = await signIn('Admin', 'admin');
      const holder = await idOf(await signIn('Holder'));
      const taker = await idOf(await signIn('Taker'));
      db.raw.prepare("UPDATE users SET pop_id = '5555' WHERE id = ?").run(holder);
      meanwhile('UPDATE users SET pop_id = NULL', lose);
      const moved = await hit(
        popIds.onRequestPost as Handler,
        '/api/admin/pop-ids',
        {},
        {
          method: 'POST',
          cookie: admin,
          body: { popId: '5555', accountId: to === 'no one' ? null : taker }
        }
      );
      assert.equal(moved.status, status);
      assert.deepEqual(one('SELECT id FROM users WHERE pop_id = ?', '5555'), [holder]);
    });
  });
});

test('an Admin still in place gives an ownerless store its Owner', async () => {
  const { admin, store, ownerId } = await adminAndStore();
  db.raw.prepare('DELETE FROM store_members WHERE user_id = ?').run(ownerId);
  const newcomer = await idOf(await signIn('Newcomer'));
  const handed = await actOn(admin, store, { owner: newcomer });
  assert.equal(handed.status, 200, JSON.stringify(handed.json));
  assert.deepEqual(people(store), [`${newcomer}:owner`]);
});

test('an Admin still in place hands a store to someone new, its Owner becoming a Manager', async () => {
  const { admin, store, ownerId } = await adminAndStore();
  const newcomer = await idOf(await signIn('Newcomer'));
  assert.equal((await actOn(admin, store, { owner: newcomer })).status, 200);
  assert.deepEqual(people(store).sort(), [`${newcomer}:owner`, `${ownerId}:manager`].sort());
  assert.equal(
    (await actOn(admin, store, { owner: newcomer })).status,
    200,
    'handing it to its Owner again lands as it stands'
  );
  assert.deepEqual(people(store).sort(), [`${newcomer}:owner`, `${ownerId}:manager`].sort());
});

/** A store its Owner runs, with a helper who joined it as Staff by a link. */
async function storeWithHelper() {
  const owner = await signIn('Owner', 'organizer');
  const store = (await storeOf(owner))!;
  const invite = await hit(
    members.onRequestPost as Handler,
    '/members',
    { id: store },
    {
      method: 'POST',
      cookie: owner,
      body: { invite: 'staff' }
    }
  );
  const helper = await signIn('Helper');
  await hit(
    join.onRequestPost as Handler,
    '/api/stores/join',
    {},
    {
      method: 'POST',
      cookie: helper,
      body: { token: invite.json.token }
    }
  );
  const handTo = (user: string) =>
    hit(
      members.onRequestPatch as Handler,
      '/members',
      { id: store },
      {
        method: 'PATCH',
        cookie: owner,
        body: { user, role: 'owner' }
      }
    );
  return { store, ownerId: await idOf(owner), helperId: await idOf(helper), handTo };
}

const HANDING = "UPDATE store_members SET role = 'handing'";

test('an Owner gone from the store meanwhile hands it to nobody, though it has no Owner left', async () => {
  const { store, ownerId, helperId, handTo } = await storeWithHelper();
  meanwhile(HANDING, () => db.raw.prepare('DELETE FROM store_members WHERE user_id = ?').run(ownerId));
  const handed = await handTo(helperId);
  assert.deepEqual([handed.status, handed.json.error], [409, 'The store was not handed over']);
  assert.deepEqual(people(store), [`${helperId}:staff`]);
});

test('an Owner signed out meanwhile hands the store to nobody and stays its Owner', async () => {
  const { store, ownerId, helperId, handTo } = await storeWithHelper();
  const before = people(store);
  meanwhile(HANDING, () => db.raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(ownerId));
  assert.equal((await handTo(helperId)).status, 409);
  assert.deepEqual(people(store), before);
});

test('an Owner still in place hands the store over and becomes a Manager', async () => {
  const { store, ownerId, helperId, handTo } = await storeWithHelper();
  assert.equal((await handTo(helperId)).status, 200);
  assert.deepEqual(people(store).sort(), [`${helperId}:owner`, `${ownerId}:manager`].sort());
});
