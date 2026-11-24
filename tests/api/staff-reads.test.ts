/**
 * What staff read of the event's staff, its head judge and its records costs
 * the database: the head judge comes with the event's own row, and the staff
 * list is read once, in the batch that writes when there is a write. A staff
 * member named by account is checked in that write, so one taken off staff
 * meanwhile is never written down.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as displays from '../../functions/api/stores/[id]/displays.ts';
import * as members from '../../functions/api/stores/[id]/members.ts';
import * as join from '../../functions/api/stores/join.ts';
import * as corrections from '../../functions/api/tournaments/[code]/corrections.ts';
import * as deckChecks from '../../functions/api/tournaments/[code]/deck-checks.ts';
import * as headJudge from '../../functions/api/tournaments/[code]/head-judge.ts';
import * as penaltyNotes from '../../functions/api/tournaments/[code]/penalty-notes.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { openStore } from '../../functions/lib/stores/access.ts';
import { openForOwner, openForStaff, openForStaffRead } from '../../functions/lib/tournaments/access.ts';
import type { D1Like, D1Statement } from '../../functions/lib/types.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { countingTrips, racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let db: ReturnType<typeof sqliteD1>;
const { hit, signIn } = apiCalls(() => env);
const { runningEvent, storeOf } = eventCalls(hit, signIn);

beforeEach(() => {
  db = sqliteD1('tournaments.sql');
  env = { TOURNAMENT_DB: db, DEV_LOGIN: 'true' };
});

const userId = (name: string) =>
  (db.raw.prepare('SELECT id FROM users WHERE handle = ?').get(name) as { id: string }).id;

/** Runs `call` counting its round trips to the database, and hands back its answer with them. */
async function counted<T>(call: () => Promise<T>): Promise<[T, number]> {
  const counting = countingTrips(db);
  env.TOURNAMENT_DB = counting.db;
  try {
    return [await call(), counting.trips()];
  } finally {
    env.TOURNAMENT_DB = db;
  }
}

const putHeadJudge = (code: string, cookie: string, id: string | null) =>
  hit(headJudge.onRequestPut as Handler, '/head-judge', at(code), { method: 'PUT', cookie, body: { userId: id } });

const note = (code: string, cookie: string, judgeId: string) =>
  hit(penaltyNotes.onRequestPost as Handler, '/penalty-notes', at(code), {
    method: 'POST',
    cookie,
    body: { playerId: '900', round: 1, judgeId, penalty: 'warning', notes: 'Extra card.' }
  });

test('the head judge is read in one trip and named in two, answering who it is and the staff', async () => {
  const { owner, code } = await runningEvent();
  const helperId = userId('helper');
  const [named, putTrips] = await counted(() => putHeadJudge(code, owner, helperId));
  assert.equal(named.status, 200);
  assert.equal(named.json.headJudge.id, helperId);
  assert.deepEqual(named.json.staff.map((s: { id: string }) => s.id).sort(), [helperId, userId('organizer')].sort());
  assert.equal(putTrips, 2, 'the event and its asker, then the write and the staff it leaves');
  const [read, getTrips] = await counted(() =>
    hit(headJudge.onRequestGet as Handler, '/head-judge', at(code), { cookie: owner })
  );
  assert.deepEqual(read.json, named.json);
  assert.equal(getTrips, 1, 'the staff with the event and its asker');
  const [cleared] = await counted(() => putHeadJudge(code, owner, null));
  assert.equal(cleared.json.headJudge, null);
});

test('a head judge taken off staff is no head judge, and one taken off meanwhile is not named', async () => {
  const { owner, code } = await runningEvent();
  const helperId = userId('helper');
  assert.equal((await putHeadJudge(code, owner, helperId)).status, 200);
  db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code);
  assert.equal(
    (await hit(headJudge.onRequestGet as Handler, '/head-judge', at(code), { cookie: owner })).json.headJudge,
    null
  );
  const read = await hit(corrections.onRequestGet as Handler, '/corrections', at(code), { cookie: owner });
  assert.deepEqual([read.json.headJudge, read.json.approver], [null, 'organizer']);
  assert.equal((await putHeadJudge(code, owner, null)).status, 200);
  db.raw.prepare('INSERT INTO staff VALUES (?, ?, 1)').run(code, helperId);
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET head_judge', () =>
    db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code)
  );
  const named = await putHeadJudge(code, owner, helperId);
  assert.deepEqual([named.status, named.json.error], [400, 'The head judge must be on this event’s staff']);
  env.TOURNAMENT_DB = db;
  assert.equal(db.raw.prepare('SELECT head_judge FROM tournaments WHERE code = ?').get(code)?.head_judge, null);
});

test('a penalty note naming a judge by account is written and answered in two trips', async () => {
  const { helper, code } = await runningEvent();
  const [recorded, trips] = await counted(() => note(code, helper, userId('organizer')));
  assert.equal(recorded.status, 200);
  assert.equal(recorded.json.entries.length, 1);
  assert.equal(trips, 2, 'the event and its asker, then the write, the record and the staff');
  const [read, readTrips] = await counted(() =>
    hit(penaltyNotes.onRequestGet as Handler, '/penalty-notes', at(code), { cookie: helper })
  );
  assert.deepEqual(read.json, recorded.json);
  assert.equal(readTrips, 1, 'the record and the staff with the event and its asker');
});

test('a judge taken off staff between the read and the write is not written down', async () => {
  const { owner, code } = await runningEvent();
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO penalty_notes', () =>
    db.raw.prepare('DELETE FROM staff WHERE code = ?').run(code)
  );
  const recorded = await note(code, owner, userId('helper'));
  assert.deepEqual([recorded.status, recorded.json.error], [400, 'The judge must be on this event’s staff']);
  env.TOURNAMENT_DB = db;
  assert.equal((db.raw.prepare('SELECT count(*) AS n FROM penalty_notes').get() as { n: number }).n, 0);
});

test('each console tab and store tab is read in one trip, and only its staff read it', async () => {
  const { owner, code } = await runningEvent();
  const store = { id: (await storeOf(owner))! };
  const tabs: [Handler, string, Record<string, string>][] = [
    [corrections.onRequestGet as Handler, '/corrections', at(code)],
    [deckChecks.onRequestGet as Handler, '/deck-checks', at(code)],
    [staff.onRequestGet as Handler, '/staff', at(code)],
    [report.onRequestGet as Handler, '/report', at(code)],
    [members.onRequestGet as Handler, '/members', store],
    [displays.onRequestGet as Handler, '/displays', store]
  ];
  const stranger = await signIn('Stranger');
  for (const [handler, path, params] of tabs) {
    const [read, trips] = await counted(() => hit(handler, path, params, { cookie: owner }));
    assert.equal(read.status, 200, path);
    assert.equal(trips, 1, `${path}: the tab's rows with the event and its asker`);
    const refused = await hit(handler, path, params, { cookie: stranger });
    assert.equal(refused.status, 403, path);
    assert.deepEqual(Object.keys(refused.json).sort(), ['error', 'status'], path);
  }
});

/** The tables the tabs show, each read from here on through a view that counts every row it reads. */
const PROTECTED = [
  'result_corrections',
  'deck_checks',
  'penalty_notes',
  'report_history',
  'display_presets',
  'store_invites',
  'staff',
  'store_members'
];

/**
 * Every row read from here on, but the asking account's own (see `asking`):
 * a standing looks up the asker's own staff or membership row, and that tells
 * the asker nothing of the tab.
 */
function countingReads(): { reads: () => number; asking: (user: string | null) => void } {
  let read = 0;
  let asker: string | null = null;
  db.raw.function('counted', (user: unknown) => {
    read += user !== null && user === asker ? 0 : 1;
    return 1;
  });
  for (const table of PROTECTED) {
    const owned = db.raw.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'user_id'`).get();
    db.raw.exec(`ALTER TABLE ${table} RENAME TO ${table}_rows`);
    db.raw.exec(`CREATE VIEW ${table} AS SELECT * FROM ${table}_rows WHERE counted(${owned ? 'user_id' : 'NULL'})`);
  }
  return { reads: () => read, asking: user => (asker = user) };
}

/** The database, refusing any batch that holds a statement whose SQL has `marker` in it. */
function failingOn(marker: string): D1Like {
  const sqlOf = new WeakMap<D1Statement, string>();
  const tracked = (statement: D1Statement, sql: string): D1Statement => {
    const wrapped = { ...statement, bind: (...values: unknown[]) => tracked(statement.bind(...values), sql) };
    sqlOf.set(wrapped, sql);
    return wrapped;
  };
  return {
    prepare: sql => tracked(db.prepare(sql), sql),
    batch: statements =>
      statements.some(statement => sqlOf.get(statement)?.includes(marker))
        ? Promise.reject(new Error('D1_ERROR: injected'))
        : db.batch(statements)
  };
}

/** A handler that only opens, as each tab's route did before its reads went along: the refusal base gave. */
const alone =
  (open: (context: never) => Promise<unknown>): Handler =>
  async context => {
    const opened = await open(context);
    return opened instanceof Response ? opened : new Response('{}');
  };

/** `body` without what a tab tells each asker of their own standing, to set beside the organizer's. */
const shown = (body: Record<string, unknown>) => ({ ...body, approver: undefined });

test('each tab lets in whom the access check alone lets in, as the organizer sees it, and a refused asker reads none of its rows, even when a read fails or its event or store is gone', async () => {
  const { owner, helper, code } = await runningEvent();
  const store = { id: (await storeOf(owner))! };
  const now = Date.now();
  db.raw
    .prepare(
      "INSERT INTO result_corrections VALUES (?, 'c1', 2, 'masters', 1, 1, '900', '901', 'win', 'loss', 'Fixed.', NULL, 'organizer', 1, 0, ?)"
    )
    .run(code, now);
  db.raw.prepare("INSERT INTO report_history VALUES (?, 2, '900', '{}', NULL, NULL)").run(code);
  db.raw
    .prepare(
      "INSERT INTO deck_checks (code, id, player_id, player_name, round, checker_name, result, notes, recorded_at) VALUES (?, 'd1', '900', 'Player 0', 1, 'Judge', 'pass', '', ?)"
    )
    .run(code, now);
  db.raw
    .prepare(
      "INSERT INTO penalty_notes (code, id, player_id, player_name, round, judge_name, penalty, notes, recorded_at) VALUES (?, 'p1', '900', 'Player 0', 1, 'Judge', 'warning', '', ?)"
    )
    .run(code, now);
  db.raw.prepare("INSERT INTO display_presets VALUES (?, 'x1', 'Hall', '{}')").run(store.id);
  const invite = await hit(members.onRequestPost as Handler, '/members', store, {
    method: 'POST',
    cookie: owner,
    body: { invite: 'staff' }
  });
  const joined = async (name: string) => {
    const token = (
      await hit(members.onRequestPost as Handler, '/members', store, {
        method: 'POST',
        cookie: owner,
        body: { invite: 'staff' }
      })
    ).json.token as string;
    const cookie = await signIn(name);
    await hit(join.onRequestPost as Handler, '/api/stores/join', {}, { method: 'POST', cookie, body: { token } });
    return cookie;
  };
  const revoked = await joined('Revoked');
  db.raw.prepare('DELETE FROM store_members WHERE user_id = ?').run(userId('revoked'));
  // A second link staff member, so a staff list read for anyone else would show in the count.
  await signIn('Second');
  db.raw.prepare('INSERT INTO staff VALUES (?, ?, 2)').run(code, userId('second'));
  const askers: Record<string, string | undefined> = {
    'signed out': undefined,
    'made-up cookie': 'cm_session=forged',
    stranger: await signIn('Stranger'),
    revoked,
    'site Admin': await signIn('Admin', 'admin'),
    'event staff': helper,
    'store Staff': await joined('Shelf')
  };
  const handles: Record<string, string> = {
    organizer: 'organizer',
    stranger: 'stranger',
    revoked: 'revoked',
    'site Admin': 'admin',
    'event staff': 'helper',
    'store Staff': 'shelf'
  };
  const everyone: Record<string, string | undefined> = { organizer: owner, ...askers };
  assert.ok(invite.json.token);
  const { reads, asking } = countingReads();
  const tabs: [Handler, string, Record<string, string>, Handler, string][] = [
    [corrections.onRequestGet as Handler, '/corrections', at(code), alone(openForStaffRead), 'FROM result_corrections'],
    [deckChecks.onRequestGet as Handler, '/deck-checks', at(code), alone(openForStaffRead), 'FROM deck_checks'],
    [penaltyNotes.onRequestGet as Handler, '/penalty-notes', at(code), alone(openForStaffRead), 'FROM penalty_notes'],
    [
      headJudge.onRequestGet as Handler,
      '/head-judge',
      at(code),
      alone(openForStaffRead),
      'UNION SELECT user_id FROM staff'
    ],
    [staff.onRequestGet as Handler, '/staff', at(code), alone(openForOwner), 'staff.joined_at'],
    [report.onRequestGet as Handler, '/report', at(code), alone(openForStaff), 'FROM report_history'],
    [
      members.onRequestGet as Handler,
      '/members',
      store,
      alone(context => openStore(context, 'manager')),
      'FROM store_invites'
    ],
    [
      displays.onRequestGet as Handler,
      '/displays',
      store,
      alone(context => openStore(context, 'member')),
      'FROM display_presets'
    ]
  ];
  /** The base answer for `cookie`, and how many tab rows a request reads beyond it. */
  const beside = async (handler: Handler, path: string, params: Record<string, string>, base: Handler, who: string) => {
    const cookie = everyone[who];
    const handle = handles[who];
    asking(handle ? userId(handle) : null);
    const start = reads();
    const expected = await hit(base, path, params, { cookie });
    const checked = reads();
    const answer = await hit(handler, path, params, { cookie });
    return { expected, answer, extra: reads() - checked - (checked - start) };
  };
  for (const [handler, path, params, base, marker] of tabs) {
    const before = reads();
    const organizer = await hit(handler, path, params, { cookie: owner });
    assert.equal(organizer.status, 200, path);
    assert.ok(reads() > before, `${path}: the views count the organizer's reads`);
    for (const [who, cookie] of Object.entries(everyone)) {
      const { expected, answer, extra } = await beside(handler, path, params, base, who);
      env.TOURNAMENT_DB = failingOn(marker);
      const failed = hit(handler, path, params, { cookie });
      if (expected.status === 200) {
        assert.equal(answer.status, 200, `${path}, ${who}: let in, as the access check alone lets them in`);
        assert.deepEqual(shown(answer.json), shown(organizer.json), `${path}, ${who}: sees what the organizer sees`);
        await assert.rejects(failed, /injected/, `${path}, ${who}: let in, hears the error`);
      } else {
        assert.deepEqual([answer.status, answer.json], [expected.status, expected.json], `${path}, ${who}`);
        assert.equal(extra, 0, `${path}, ${who}: no row beyond the access check's`);
        const refusal = await failed;
        assert.deepEqual([refusal.status, refusal.json], [expected.status, expected.json], `${path}, ${who}, failing`);
      }
      env.TOURNAMENT_DB = db;
    }
  }
  // Rows left behind by an event or a store that is gone: nobody reads them, and the answer is base's 404.
  db.raw.prepare('DELETE FROM tournaments WHERE code = ?').run(code);
  db.raw.prepare('DELETE FROM stores WHERE id = ?').run(store.id);
  for (const [handler, path, params, base] of tabs) {
    for (const who of Object.keys(everyone)) {
      const { expected, answer, extra } = await beside(handler, path, params, base, who);
      assert.equal(expected.status, 404, `${path}, ${who}: gone`);
      assert.deepEqual([answer.status, answer.json], [expected.status, expected.json], `${path}, ${who}: gone`);
      assert.equal(extra, 0, `${path}, ${who}: no row of what is gone`);
    }
  }
});
