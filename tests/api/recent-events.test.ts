import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as recent from '../../functions/api/recent-events.ts';
import { apiSuite, type Handler } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const { env, hit, signIn } = apiSuite(recent);
const { newEvent, addPlayers, settle } = eventCalls(hit);
const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
const list = async () => {
  const answer = await hit(recent.onRequestGet as Handler, '/api/recent-events', {});
  assert.equal(answer.status, 200);
  return answer.json.events as recent.RecentEvent[];
};

/**
 * An event of the organizer signed in under `cookie`, named `name`, set to
 * start at `startsAt`, with three players; `paired` gives it a round played,
 * `finished` ends it.
 */
async function event(cookie: string, name: string, startsAt: string, { paired = true, finished = true } = {}) {
  const code = await newEvent(cookie, { name });
  await addPlayers(code, cookie, 3);
  if (finished) {
    await settle(code, cookie, { finished: true });
  }
  const { raw } = db();
  raw
    .prepare("UPDATE tournaments SET settings = json_set(settings, '$.startsAt', ?) WHERE code = ?")
    .run(startsAt, code);
  if (paired) {
    raw
      .prepare("UPDATE tournaments SET state = json_set(state, '$.pods[0].rounds', json('[[]]')) WHERE code = ?")
      .run(code);
  }
  return code;
}

test('lists each store’s newest finished event, newest first, with its place and players', async () => {
  const north = await signIn('North', 'organizer');
  const south = await signIn('South', 'organizer');
  await event(north, 'North Locals', '2026-10-01T19:00');
  const northLatest = await event(north, 'North Locals', '2026-11-05T19:30');
  const southLatest = await event(south, 'South Cup', '2026-10-18T15:00');
  db().raw.prepare("UPDATE stores SET city = 'San Antonio', region = 'TX' WHERE name = 'South Games'").run();

  const events = await list();
  assert.deepEqual(
    events.map(e => e.code),
    [northLatest, southLatest]
  );
  assert.deepEqual(events[1], {
    code: southLatest,
    name: 'South Cup',
    place: 'South Games · San Antonio, TX',
    startsAt: '2026-10-18T15:00',
    startDate: events[1]?.startDate,
    players: 3
  });
  assert.equal(events[0]?.place, 'North Games');
});

test('leaves out events still open, events that never paired, and inactive stores', async () => {
  const open = await signIn('Open', 'organizer');
  const empty = await signIn('Empty', 'organizer');
  const closed = await signIn('Closed', 'organizer');
  await event(open, 'Still running', '2026-11-06T19:00', { finished: false });
  await event(empty, 'Never paired', '2026-11-06T19:00', { paired: false });
  await event(closed, 'Closed store', '2026-11-06T19:00');
  db().raw.prepare("UPDATE stores SET status = 'closed' WHERE name = 'Closed Games'").run();
  assert.deepEqual(await list(), []);
});

test('keeps an open event from hiding its store’s finished one', async () => {
  const store = await signIn('Busy', 'organizer');
  const done = await event(store, 'Last week', '2026-10-30T19:00');
  await event(store, 'Tonight', '2026-11-07T19:00', { finished: false });
  assert.deepEqual(
    (await list()).map(e => e.code),
    [done]
  );
});

test('holds six at most and is cached publicly', async () => {
  for (let i = 0; i < 8; i += 1) {
    await event(await signIn(`Store ${i}`, 'organizer'), `Event ${i}`, `2026-10-${10 + i}T19:00`);
  }
  const answer = await hit(recent.onRequestGet as Handler, '/api/recent-events', {});
  assert.equal(answer.json.events.length, recent.RECENT_EVENTS);
  assert.equal(answer.json.events[0].name, 'Event 7');
  assert.equal(answer.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(answer.headers.get('Access-Control-Allow-Origin'), null);
});

test('leaves out events run under an organizer’s own name', async () => {
  const admin = await signIn('Admin', 'admin');
  await event(admin, 'House event', '2026-11-06T19:00');
  assert.deepEqual(await list(), []);
});

test('an event with no start time sorts by its TOM date', async () => {
  const dated = await signIn('Dated', 'organizer');
  const undated = await signIn('Undated', 'organizer');
  await event(dated, 'Dated', '2026-10-01T19:00');
  const code = await event(undated, 'Undated', '');
  db()
    .raw.prepare("UPDATE tournaments SET state = json_set(state, '$.info.startDate', '11/02/2026') WHERE code = ?")
    .run(code);
  const events = await list();
  assert.deepEqual(
    events.map(e => e.name),
    ['Undated', 'Dated']
  );
  assert.equal(events[0]?.startDate, '11/02/2026');
});
