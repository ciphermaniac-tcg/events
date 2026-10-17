import assert from 'node:assert/strict';
import test from 'node:test';
import { ASK_BEFORE_MS, asksWhoYouAre, eventTimes, zonedInstant } from '../../shared/tournament/eventTime.ts';
import { isTimeZone, isWallClock } from '../../shared/tournament/timeZone.ts';

test('only zones the runtime knows are time zones', () => {
  for (const zone of ['America/Chicago', 'Europe/London', 'UTC', 'Asia/Kolkata']) {
    assert.equal(isTimeZone(zone), true, zone);
  }
  for (const zone of ['', 'Mars/Base', 'CST6CDT'.repeat(10), 42, null, undefined]) {
    assert.equal(isTimeZone(zone), false, String(zone));
  }
});

test('a wall-clock time names one instant in its zone, either side of daylight saving', () => {
  assert.equal(zonedInstant('2026-10-18T12:00', 'America/Chicago'), Date.parse('2026-10-18T17:00:00Z'));
  assert.equal(zonedInstant('2026-12-18T12:00', 'America/Chicago'), Date.parse('2026-12-18T18:00:00Z'));
  assert.equal(zonedInstant('2026-07-04T09:30', 'Europe/London'), Date.parse('2026-07-04T08:30:00Z'));
  assert.equal(zonedInstant('2026-10-18T12:00', 'Asia/Kolkata'), Date.parse('2026-10-18T06:30:00Z'));
  // The hour after the clocks go back happens twice: the first occurrence, in daylight time.
  assert.equal(zonedInstant('2026-11-01T01:30', 'America/Chicago'), Date.parse('2026-11-01T06:30:00Z'));
  assert.equal(zonedInstant('2026-10-25T01:30', 'Europe/London'), Date.parse('2026-10-25T00:30:00Z'));
  // The skipped hour moves forward by the gap: 02:30 reads as 03:30 daylight time.
  assert.equal(zonedInstant('2026-03-08T02:30', 'America/Chicago'), Date.parse('2026-03-08T08:30:00Z'));
  assert.equal(zonedInstant('2026-03-29T01:15', 'Europe/London'), Date.parse('2026-03-29T01:15:00Z'));
  assert.match(eventTimes('2026-03-08T02:30', 'America/Chicago', 'America/Chicago').event, /3:30.*CDT/);
});

test('viewers elsewhere see the event’s time and their own; viewers in step see one', () => {
  const chicago = eventTimes('2026-10-18T12:00', 'America/Chicago', 'America/Los_Angeles');
  assert.match(chicago.event, /12:00/);
  assert.match(chicago.event, /CDT/);
  assert.match(chicago.yours ?? '', /10:00/);
  assert.match(chicago.yours ?? '', /PDT/);
  assert.equal(eventTimes('2026-10-18T12:00', 'America/Chicago', 'America/Chicago').yours, null);
  // A different zone on the same clock that day reads the same.
  assert.equal(eventTimes('2026-10-18T12:00', 'America/Chicago', 'America/Winnipeg').yours, null);
  const asWritten = eventTimes('2026-10-18T12:00', '', 'Asia/Tokyo');
  assert.match(asWritten.event, /12:00/);
  assert.equal(asWritten.yours, null);
});

test('a wall-clock time names a real day, hour and minute', () => {
  for (const value of ['2026-10-18T12:00', '2028-02-29T00:00', '2026-12-31T23:59']) {
    assert.equal(isWallClock(value), true, value);
  }
  for (const value of [
    '',
    '2026-10-18T99:00',
    '2026-10-18T24:00',
    '2026-10-18T12:60',
    '2026-02-30T10:00',
    '2027-02-29T10:00',
    '2026-13-01T10:00',
    '2026-00-10T10:00',
    '2026-10-18 12:00',
    202610181200,
    null
  ]) {
    assert.equal(isWallClock(value), false, String(value));
  }
});

test('a stored time that names no real moment shows as written instead of failing or rolling over', () => {
  assert.deepEqual(eventTimes('2026-10-18T99:00', 'America/Chicago', 'Asia/Tokyo'), {
    event: '2026-10-18T99:00',
    yours: null
  });
  assert.deepEqual(eventTimes('2026-02-30T10:00', '', 'Asia/Tokyo'), { event: '2026-02-30T10:00', yours: null });
});

test('the page asks who you are from three hours before the start, or once round 1 is paired', () => {
  const settings = { startsAt: '2026-10-24T11:00', timeZone: 'America/Chicago' };
  const start = Date.UTC(2026, 9, 24, 16, 0);
  assert.equal(asksWhoYouAre(false, settings, start - ASK_BEFORE_MS - 1), false);
  assert.equal(asksWhoYouAre(false, settings, start - ASK_BEFORE_MS), true);
  assert.equal(asksWhoYouAre(true, settings, 0), true, 'round 1 opens it whatever the clock says');
  assert.equal(asksWhoYouAre(false, { startsAt: '', timeZone: '' }, start), false, 'no start, no question');
  const local = { startsAt: '2026-10-24T11:00', timeZone: '' };
  assert.equal(
    asksWhoYouAre(false, local, new Date('2026-10-24T08:00').getTime()),
    true,
    'as the viewer’s clock reads'
  );
});
