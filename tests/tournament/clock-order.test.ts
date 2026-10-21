/** Which clock leads the big screen when divisions play rounds of their own. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, PodCategory, Round } from '../../shared/tournament/types.ts';
import type { PendingResult } from '../../shared/tournament/view.ts';
import { divisionClocks, onExtraTime } from '../../src/pages/tournaments/clockOrder.ts';

const fixture = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const base = fixture.pods[0]!;
const NOW = 1_000_000;

/** The fixture's pod as a division, its latest round changed by `round`. */
function pod(category: PodCategory, round: Partial<Round>): Pod {
  const latest = base.rounds.at(-1)!;
  return { ...base, category, rounds: [...base.rounds.slice(0, -1), { ...latest, ...round }] };
}
const waiting = { startTime: '', clockStartedAt: null, timeLeft: 3000 };
const running = (timeLeft: number) => ({ startTime: '10:00', clockStartedAt: NOW, timeLeft });
const paused = { startTime: '10:00', clockStartedAt: null, timeLeft: 1325 };
const decided = (r: Round) => ({ matches: r.matches.map(m => ({ ...m, outcome: m.p2 ? 'p1' : m.outcome })) });

test('a division still waiting to start never leads over one whose clock runs', () => {
  const clocks = divisionClocks([pod('masters', waiting), pod('senior', running(2322))], [], NOW);
  assert.deepEqual(
    clocks.map(c => [c.label, c.state]),
    [
      ['Seniors · Round 2', 'running'],
      ['Masters · Round 2', 'waiting']
    ]
  );
});

test('of running clocks, the one with the least time left leads; the rest keep division order', () => {
  const clocks = divisionClocks(
    [pod('junior', running(1800)), pod('senior', running(900)), pod('masters', running(2400))],
    [],
    NOW + 60_000
  );
  assert.deepEqual(
    clocks.map(c => [c.label, c.left]),
    [
      ['Seniors · Round 2', 840],
      ['Juniors · Round 2', 1740],
      ['Masters · Round 2', 2340]
    ]
  );
});

test('a paused clock leads a division done reporting, and each says which it is', () => {
  const latest = base.rounds.at(-1)!;
  const clocks = divisionClocks(
    [pod('senior', { ...running(10), ...decided(latest) }), pod('masters', paused)],
    [],
    NOW
  );
  assert.deepEqual(
    clocks.map(c => c.state),
    ['paused', 'done']
  );
  assert.deepEqual(divisionClocks([], [], NOW), []);
});

test('once the round clock is out, only tables still playing with extra time left count as on extra time', () => {
  const latest = base.rounds.at(-1)!;
  const open = latest.matches.filter(m => m.p2 !== null && m.outcome === 'pending');
  assert.ok(open.length >= 2);
  const extended = latest.matches.map(m =>
    m.p2 !== null ? { ...m, timeExtension: { seconds: 300, reason: 'Deck check' } } : m
  );
  const [clock] = divisionClocks([pod('masters', { ...running(60), matches: extended })], [], NOW);
  assert.equal(onExtraTime(clock!, [], NOW), 0, 'the round clock still runs');
  assert.equal(onExtraTime(clock!, [], NOW + 120_000), open.length, 'a minute over, five minutes on');
  assert.equal(onExtraTime(clock!, [], NOW + 360_000), 0, 'the extension is spent too');
  const [first] = open;
  const reported: PendingResult[] = [
    { pod: 'masters', round: latest.number, table: first!.table, p1: first!.p1, p2: first!.p2, outcome: 'p1', at: NOW }
  ];
  assert.equal(onExtraTime(clock!, reported, NOW + 120_000), open.length - 1, 'a result entered on the site');
});
