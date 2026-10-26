import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Command } from '../../shared/tournament/commands.ts';
import {
  correctableMatch,
  correctedTournament,
  type CorrectionRequest,
  lockedRound,
  nextMatches,
  pairedThrough,
  readCorrection,
  roundRefusal
} from '../../shared/tournament/corrections.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { commandRunner, freshContext, pendingResults } from '../__utils__/commands.ts';

const run = commandRunner(freshContext(5, '10/14/2026 18:00:00'));

const masters = (t: Tournament) => t.pods.find(pod => pod.category === 'masters') as Pod;

/** Every two-player match of the latest round won by its first seat. */
const reportAll = (t: Tournament): Tournament => run(t, ...pendingResults(masters(t)));

const ADDS: Command[] = Array.from({ length: 8 }, (_, i) => ({
  type: 'addPlayer',
  player: { firstName: `P${i + 1}`, lastName: 'Test' }
}));

/** Eight players, round 1 played and round 2 paired. */
function inRound2(): Tournament {
  const r1 = reportAll(run(emptyTournament({ name: 'Friday League' }), ...ADDS, { type: 'pairRound', pod: 'masters' }));
  return run(r1, { type: 'pairRound', pod: 'masters' });
}

const SITE = { tom: false, finished: false, paired: {} };

/** The request that turns round 1 table 1 around, on the event's version 4. */
function flipTable1(t: Tournament): CorrectionRequest {
  const match = masters(t).rounds[0]!.matches.find(m => m.table === 1)!;
  return {
    pod: 'masters',
    round: 1,
    table: 1,
    p1: match.p1,
    p2: match.p2!,
    outcome: 'p2',
    note: 'Slip signed for the wrong winner.',
    version: 4
  };
}

test('a correction reads from a body, and a body missing a field says which', () => {
  const body = { pod: 'masters', round: 1, table: 3, p1: ' a ', p2: 'b', outcome: 'tie', note: ' Slip 3 ', version: 7 };
  assert.deepEqual(readCorrection(body), { ...body, p1: 'a', note: 'Slip 3' });
  const refusals: [Record<string, unknown>, string][] = [
    [{ pod: 'adults' }, 'Say which pod'],
    [{ round: 0 }, 'Say which round'],
    [{ table: -1 }, 'Say which table'],
    [{ p2: '' }, 'Say which match'],
    [{ outcome: 'pending' }, 'Choose the result it should have'],
    [{ outcome: 'bye' }, 'Choose the result it should have'],
    [{ note: '  ' }, 'Say which slip and what was wrong'],
    [{ note: 'x'.repeat(501) }, 'Keep the note under 500 characters'],
    [{ version: undefined }, 'Look at the event again first']
  ];
  for (const [change, problem] of refusals) {
    assert.equal(readCorrection({ ...body, ...change }), problem, problem);
  }
});

test('round 1 is correctable while round 2 is the latest round, and only then', () => {
  const t = inRound2();
  assert.equal(roundRefusal(masters(t), 1, SITE), null, 'during round 2');
  assert.equal(roundRefusal(masters(t), 2, SITE), 'Round 2 is the current round. Change its results from its table.');
  assert.equal(roundRefusal(masters(t), 5, SITE), 'Round 5 is not a Swiss round of this event.');

  const r3 = run(reportAll(t), { type: 'pairRound', pod: 'masters' });
  assert.equal(
    roundRefusal(masters(r3), 1, SITE),
    'Round 1 can no longer be corrected. Its records locked when round 3 was paired.'
  );
  assert.equal(roundRefusal(masters(r3), 2, SITE), null, 'round 2 takes over the window');
});

test('a TOM event, an ended one and a started top cut take no corrections', () => {
  const pod = masters(inRound2());
  assert.equal(
    roundRefusal(pod, 1, { tom: true, finished: false, paired: {} }),
    'This event runs in TOM. Correct the result in TOM, then sync.'
  );
  assert.equal(roundRefusal(pod, 1, { tom: false, finished: true, paired: {} }), 'The event has ended.');
  const cut = 'The top cut has started, so Swiss results can no longer be corrected here.';
  const eliminating = { ...pod, rounds: [pod.rounds[0]!, { ...pod.rounds[1]!, kind: 'elimination' as const }] };
  assert.equal(roundRefusal(eliminating, 1, SITE), cut);
  assert.equal(
    roundRefusal({ ...pod, divisionCuts: { masters: { size: 4, playoff3rd4th: false, playerIds: [] } } }, 1, SITE),
    cut
  );
});

test('a correction names the match as it stands and a result it does not already have', () => {
  const t = inRound2();
  const request = flipTable1(t);
  assert.equal((correctableMatch(t, request, SITE) as { table: number }).table, 1);
  assert.equal(correctableMatch(t, { ...request, pod: 'junior' }, SITE), 'That pod is not on this event.');
  assert.equal(correctableMatch(t, { ...request, p2: 'someone' }, SITE), 'That match has changed. Look again.');
  assert.equal(correctableMatch(t, { ...request, table: 99 }, SITE), 'That match has changed. Look again.');
  assert.equal(correctableMatch(t, { ...request, outcome: 'p1' }, SITE), 'That is already its result.');
});

test('a correction changes that one result, and the standings and next pairings read from it', () => {
  const t = inRound2();
  const request = flipTable1(t);
  const corrected = correctedTournament(t, request, '10/14/2026 18:40:00');

  const before = masters(t);
  const after = masters(corrected);
  const changed = after.rounds.flatMap((r, i) =>
    r.matches.filter((m, j) => JSON.stringify(m) !== JSON.stringify(before.rounds[i]!.matches[j]))
  );
  assert.deepEqual(changed, [
    { ...before.rounds[0]!.matches.find(m => m.table === 1)!, outcome: 'p2', timestamp: '10/14/2026 18:40:00' }
  ]);
  assert.deepEqual(after.rounds[1], before.rounds[1], 'round 2 stays as paired');
  assert.deepEqual(corrected.players, t.players);

  const record = (tt: Tournament, id: string) =>
    swissStandings(masters(tt), tt.players).find(row => row.playerId === id)?.record;
  assert.deepEqual(record(corrected, request.p1), { wins: 0, losses: 1, ties: 0 });
  assert.deepEqual(record(corrected, request.p2), { wins: 1, losses: 0, ties: 0 });

  const next = nextMatches(corrected, request);
  assert.equal(next.length, 2, 'each corrected player sits one round 2 match');
  for (const match of next) {
    const seat = [match.p1, match.p2].indexOf(request.p1);
    if (seat >= 0) {
      assert.equal(match.points[seat], 0, 'the old winner goes into round 2 on no points');
    }
  }
});

test('the rounds a pod has paired only ever rise, and a round deleted since still locks the window', () => {
  const t = inRound2();
  assert.deepEqual(pairedThrough({}, t), { masters: 2 });
  assert.deepEqual(pairedThrough({ masters: 3 }, t), { masters: 3 }, 'a deleted round 3 is not forgotten');
  assert.equal(
    roundRefusal(masters(t), 1, { ...SITE, paired: { masters: 3 } }),
    'Round 1 can no longer be corrected. Its records locked when round 3 was paired.'
  );
  assert.equal(
    roundRefusal(masters(t), 1, { ...SITE, paired: { junior: 9 } }),
    null,
    'another pod’s rounds do not count'
  );
  assert.equal(lockedRound(3, 2), null);
  assert.equal(lockedRound(3, 1), 'Round 1 can no longer be corrected. Its records locked when round 3 was paired.');
});
