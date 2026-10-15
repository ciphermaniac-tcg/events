import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DISPLAY, readDisplayOptions, readDisplayPreset } from '../../shared/tournament/display.ts';

test('display presets validate all sizing/timing fields and trim names', () => {
  assert.deepEqual(readDisplayPreset({ name: ' TV ', options: DEFAULT_DISPLAY }), {
    name: 'TV',
    options: DEFAULT_DISPLAY
  });
  for (const value of [
    null,
    {},
    { ...DEFAULT_DISPLAY, scale: Infinity },
    { ...DEFAULT_DISPLAY, scale: 0.5 },
    { ...DEFAULT_DISPLAY, pageSeconds: 1.5 },
    { ...DEFAULT_DISPLAY, layout: 'unknown' }
  ]) {
    assert.equal(readDisplayOptions(value), null);
  }
});

test('a preset made from the room keeps whole inches and feet within reach, and older presets need none', () => {
  const room = { inches: 43, feet: 18 };
  assert.deepEqual(readDisplayOptions({ ...DEFAULT_DISPLAY, room }), { ...DEFAULT_DISPLAY, room });
  assert.deepEqual(readDisplayOptions(DEFAULT_DISPLAY), DEFAULT_DISPLAY);
  for (const bad of [
    null,
    {},
    { inches: 43 },
    { inches: 43.5, feet: 18 },
    { inches: 10, feet: 18 },
    { inches: 43, feet: 500 }
  ]) {
    assert.equal(readDisplayOptions({ ...DEFAULT_DISPLAY, room: bad }), null);
  }
});
