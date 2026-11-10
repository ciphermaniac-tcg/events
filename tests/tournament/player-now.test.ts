import assert from 'node:assert/strict';
import test from 'node:test';
import type { Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { playerNow } from '../../src/lib/tournament/playerNow';
import { commandRunner, freshContext, pendingResults } from '../__utils__/commands';

const run = commandRunner(freshContext(3, '09/29/2026 10:00:00'));

/** An unsanctioned event of `count` players. */
function event(count: number) {
  const adds: Command[] = Array.from({ length: count }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  return run(emptyTournament({ name: 'Friday League' }), ...adds);
}

test('before round 1 a player is in no round', () => {
  const t = event(4);
  assert.deepEqual(playerNow(t, t.players[0]!.id), { kind: 'none' });
});

test('a seated player has their table and opponent, and the result once it is in', () => {
  const t = run(event(4), { type: 'pairRound', pod: 'masters' });
  const match = t.pods[0]!.rounds[0]!.matches[0]!;
  const now = playerNow(t, match.p1);
  assert.equal(now.kind, 'table');
  assert.deepEqual(now.kind === 'table' && [now.round.number, now.table, now.opponent, now.mark], [1, 1, match.p2, '']);
  const reported = run(t, ...pendingResults(t.pods[0]!));
  const after = playerNow(reported, match.p2 as string);
  assert.deepEqual(after.kind === 'table' && [after.opponent, after.mark], [match.p1, 'L']);
});

test('an odd player out is on a bye', () => {
  const t = run(event(3), { type: 'pairRound', pod: 'masters' });
  const bye = t.pods[0]!.rounds[0]!.matches.find(m => m.p2 === null)!;
  const now = playerNow(t, bye.p1);
  assert.deepEqual([now.kind, now.kind === 'bye' && now.round.number], ['bye', 1]);
});

test('a player dropped before the round was paired is out, and says after which round', () => {
  let t = run(event(4), { type: 'pairRound', pod: 'masters' });
  t = run(t, ...pendingResults(t.pods[0]!));
  const { id } = t.players[0]!;
  t = run(t, { type: 'dropPlayer', id }, { type: 'pairRound', pod: 'masters' });
  assert.deepEqual(playerNow(t, id), { kind: 'out', after: 1, disqualified: false });
});
