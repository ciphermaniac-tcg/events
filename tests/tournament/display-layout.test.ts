import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_DISPLAY } from '../../shared/tournament/display.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import {
  displayCapacity,
  displayFont,
  displayRows,
  pagedDisplay,
  roomScale
} from '../../src/pages/tournaments/displayLayout.ts';

const tournament = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));

test('viewport size and manual scale determine legible text without applying physical DPI twice', () => {
  assert.equal(displayFont({ width: 1920, height: 1080 }, 1), 32);
  assert.equal(displayFont({ width: 1920, height: 1080 }, 1.5), 48);
  assert.equal(displayFont({ width: 3840, height: 2160 }, 1), 64);
  assert.equal(displayFont({ width: 640, height: 480 }, 1), 18);
  const size = { width: 1760, height: 640 };
  const normal = displayCapacity(size, 32);
  const large = displayCapacity(size, 48);
  assert.ok(normal.total > large.total);
  assert.ok(displayCapacity(size, 48, true).columns > large.columns);
  assert.deepEqual(displayCapacity({ width: 0, height: 0 }, 32), { rows: 1, columns: 1, total: 1 });
  // Scrolling is the default at any size; only a preset asking for pages pages.
  assert.equal(pagedDisplay(DEFAULT_DISPLAY), false);
  assert.equal(pagedDisplay({ ...DEFAULT_DISPLAY, layout: 'auto' }), false);
  assert.equal(pagedDisplay({ ...DEFAULT_DISPLAY, layout: 'tables' }), true);
  assert.equal(pagedDisplay({ ...DEFAULT_DISPLAY, layout: 'alphabetical' }), true);
});

test('dense alphabetical rows include each seat and bye once, use each pod latest round, and sort by first name as shown', () => {
  const rows = displayRows(tournament, tournament.pods, true);
  const tables = displayRows(tournament, tournament.pods, false);
  const matches = tournament.pods.flatMap(pod => pod.rounds.at(-1)?.matches ?? []);
  assert.equal(tables.length, matches.length);
  assert.equal(
    rows.length,
    matches.reduce((count, match) => count + (match.p2 ? 2 : 1), 0)
  );
  assert.equal(new Set(rows.map(row => row.player)).size, rows.length);
  const names = rows.map(row => {
    const p = tournament.players.find(player => player.id === row.player)!;
    return `${p.firstName} ${p.lastName}`;
  });
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b))
  );
  assert.deepEqual(displayRows(tournament, [], true), []);
});

test('the room sets the text size: a wall TV read from across the store needs more than a projector read up close', () => {
  assert.equal(roomScale({ inches: 43, feet: 18 }), 1.65);
  assert.equal(roomScale({ inches: 43, feet: 10 }), 0.9);
  assert.equal(roomScale({ inches: 100, feet: 25 }), 1);
  assert.equal(roomScale({ inches: 32, feet: 40 }), 2);
  assert.equal(roomScale({ inches: 120, feet: 6 }), 0.75);
  // The same room measured in metres: 18 feet is 5.5 metres to a tenth.
  assert.equal(roomScale({ inches: 43, metres: 5.5 }), 1.65);
});
