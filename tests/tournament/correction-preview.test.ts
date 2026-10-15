import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { correctionPreview, standingChanges } from '../../src/lib/tournament/corrections.ts';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const ctx = { now: 0, localTime: '10/14/2026 18:00:00', season: 2027, random: seededRandom(5) };
    const result = applyCommand(current, command, ctx);
    if (!result.ok) {
      throw new Error(`${command.type}: ${result.error}`);
    }
    current = result.tournament;
  }
  return current;
}

const masters = (t: Tournament) => t.pods.find(pod => pod.category === 'masters') as Pod;

/** Eight players, round 1 won by every first seat, round 2 paired. */
function inRound2(): Tournament {
  const adds = Array.from({ length: 8 }, (_, i): Command => ({
    type: 'addPlayer',
    player: { firstName: `P${i + 1}`, lastName: 'Test' }
  }));
  const paired = run(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
  const reports = masters(paired)
    .rounds[0]!.matches.filter(m => m.p2 !== null)
    .map((m): Command => ({
      type: 'reportResult',
      pod: 'masters',
      round: 1,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1'
    }));
  return run(run(paired, ...reports), { type: 'pairRound', pod: 'masters' });
}

test('a preview lists the standings a correction moves, before and after, and the next round it touches', () => {
  const t = inRound2();
  const match = masters(t).rounds[0]!.matches.find(m => m.table === 1)!;
  const preview = correctionPreview(t, masters(t), {
    pod: 'masters',
    round: 1,
    table: 1,
    p1: match.p1,
    p2: match.p2!,
    outcome: 'p2'
  });
  assert.equal(preview.standings.length, 1, 'one division, one table of changes');
  const [group] = preview.standings;
  assert.equal(group?.division, null);
  const of = (id: string) => group?.changes.find(change => change.after.playerId === id);
  assert.deepEqual(of(match.p1)?.before.record, { wins: 1, losses: 0, ties: 0 });
  assert.deepEqual(of(match.p1)?.after.record, { wins: 0, losses: 1, ties: 0 });
  assert.deepEqual(of(match.p2 ?? '')?.after.record, { wins: 1, losses: 0, ties: 0 });
  const places = group?.changes.map(change => change.after.place) ?? [];
  assert.deepEqual(
    places,
    [...places].sort((a, b) => a - b),
    'in their new order'
  );

  assert.equal(preview.next.length, 2);
  assert.ok(preview.next.every(m => [m.p1, m.p2].some(id => id === match.p1 || id === match.p2)));
});

test('standings that do not move are left out, and a division with none drops away', () => {
  const t = inRound2();
  const rows = correctionPreview(t, masters(t), {
    pod: 'masters',
    round: 1,
    table: 1,
    p1: 'x',
    p2: 'y',
    outcome: 'p2'
  });
  assert.deepEqual(rows.standings, [], 'a match that is not there changes nothing');
  const same = { division: null, rows: [], cut: 0, cutStarted: false };
  assert.deepEqual(standingChanges([same], [same]), []);
});
