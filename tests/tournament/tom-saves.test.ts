/**
 * TOM's autosave beat, read from the times its file changed: unknown until a
 * gap comes round twice, kept through saves in between, and late after two
 * beats with no save.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { autosaveMinutes, minutesSince, savesLate, withSave } from '../../src/lib/tournament/tomSaves.ts';

const at = (minutes: number) => minutes * 60_000;
const saves = (...minutes: number[]) => minutes.map(at);

test('the beat is unknown until a gap has come round twice', () => {
  assert.equal(autosaveMinutes([]), null);
  assert.equal(autosaveMinutes(saves(0)), null);
  assert.equal(autosaveMinutes(saves(0, 5)), null);
  assert.equal(autosaveMinutes(saves(0, 5, 10)), 5);
});

test('saves in between split a gap without hiding the beat', () => {
  // Top Deck, October 15: autosaves on :33 and :38, with saves on :00 and :05 from entering results.
  assert.equal(autosaveMinutes(saves(33, 38, 43, 48, 53, 58, 60, 63, 65, 68, 73)), 5);
});

test('a beat the organizer changed is read like the default', () => {
  assert.equal(autosaveMinutes(saves(0, 2, 4, 6)), 2);
  assert.equal(autosaveMinutes(saves(0, 10, 20)), 10);
});

test('gaps a few seconds off the beat still round to it', () => {
  assert.equal(autosaveMinutes([0, at(5) - 4000, at(10) + 3000]), 5);
});

test('saves seconds apart are no beat', () => {
  assert.equal(autosaveMinutes([0, 10_000, 20_000, 30_000]), null);
});

test('a burst of saves while results go in does not pass for the beat', () => {
  // Autosaves every five minutes, and four more a minute apart after :10 while a round's results go in.
  assert.equal(autosaveMinutes(saves(0, 5, 10, 11, 12, 13, 14, 15, 20)), 5);
  assert.equal(autosaveMinutes(saves(0, 2, 4, 9, 14)), 5);
});

test('the saves kept are the newest, oldest first, without the same save twice', () => {
  let kept: number[] = [];
  for (let minute = 0; minute < 20; minute += 1) {
    kept = withSave(kept, at(minute));
  }
  assert.equal(kept.length, 12);
  assert.equal(kept[0], at(8));
  assert.deepEqual(withSave(kept, at(19)), kept);
});

test('TOM is late after two beats without a save, and never without a beat', () => {
  assert.equal(savesLate(at(10), at(0), 5), false);
  assert.equal(savesLate(at(11), at(0), 5), true);
  assert.equal(savesLate(at(60), at(0), null), false);
});

test('minutes since a save are whole and never negative', () => {
  assert.equal(minutesSince(at(4) + 59_000, 0), 4);
  assert.equal(minutesSince(0, at(1)), 0);
});
