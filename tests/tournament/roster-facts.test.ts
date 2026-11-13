/**
 * A roster row's pod, round marks and late entry, worked out once for the
 * event, say the same as reading each player's history on its own.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { joinedLate, playerPod } from '../../shared/tournament/rounds.ts';
import type { Match, Outcome, Pod, Tournament } from '../../shared/tournament/types.ts';
import { matchHistory } from '../../src/lib/tournament/present.ts';
import { rosterFacts } from '../../src/pages/tournaments/rosterFacts.ts';
import { juniorsCutApart } from '../__utils__/divisionCuts.ts';

/** The roster's own reading, which the index must keep: marks per round, padded, and a late entry. */
function reference(tournament: Tournament) {
  const shown = new Map<string, { marks: string[]; rounds: number; late: boolean }>();
  for (const player of tournament.players) {
    const pod = playerPod(tournament, player.id);
    if (!pod) {
      continue;
    }
    const rounds = new Map(matchHistory(pod, player.id).map(row => [row.round, row.mark]));
    shown.set(player.id, {
      marks: pod.rounds.map(round => rounds.get(round.number) ?? ''),
      rounds: pod.rounds.length,
      late: joinedLate(pod, player.id)
    });
  }
  return shown;
}

function check(tournament: Tournament) {
  const expected = reference(tournament);
  const facts = rosterFacts(tournament);
  for (const player of tournament.players) {
    const want = expected.get(player.id);
    const got = facts.get(player.id);
    if (!want) {
      assert.equal(got, undefined, `${player.id} is in no pod`);
      continue;
    }
    assert.ok(got, `${player.id} has facts`);
    assert.equal(got.pod.category, playerPod(tournament, player.id)?.category);
    assert.deepEqual(got.marks, want.marks, `${player.id} marks`);
    assert.equal(got.joinedLate, want.late, `${player.id} late`);
  }
  assert.equal(facts.size, expected.size);
}

const round = (number: number, matches: Match[]): Pod['rounds'][number] => ({
  number,
  kind: 'swiss',
  status: 'finished',
  timeLeft: 0,
  pairTime: '',
  startTime: '',
  matches
});

const match = (table: number, p1: string, p2: string | null, outcome: Outcome): Match => ({
  table,
  p1,
  p2,
  outcome,
  timestamp: ''
});

test('roster facts match each player’s own history, byes and missed rounds included', () => {
  const tournament: Tournament = {
    info: {
      name: 'Facts',
      sanctionId: '',
      city: '',
      state: '',
      country: '',
      roundTime: 50,
      finalsRoundTime: 50,
      organizerPopId: '',
      organizerName: '',
      startDate: ''
    },
    players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id, i) => ({
      id,
      firstName: 'F',
      lastName: `L${i}`,
      birthDate: '',
      droppedAfter: null,
      created: '',
      modified: ''
    })),
    pods: [
      {
        category: 'masters',
        playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
        rounds: [
          round(1, [match(1, 'p1', 'p2', 'p1'), match(2, 'p3', 'p4', 'tie'), match(3, 'p5', null, 'loss')]),
          round(2, [match(1, 'p1', 'p3', 'p2'), match(2, 'p2', 'p4', 'p1'), match(3, 'p5', 'p6', 'p2')])
        ],
        cut: 0,
        playoff3rd4th: false,
        startingTable: 1
      }
    ]
  };
  check(tournament);
  // p7 was in the pod but never paired: an empty mark per round, as the row drew before.
  assert.deepEqual(rosterFacts(tournament).get('p7')?.marks, ['', '']);
  // p5 missed round 1 as a late entry, and p6 only played round 2.
  assert.equal(rosterFacts(tournament).get('p5')?.joinedLate, true);
  assert.equal(rosterFacts(tournament).get('p6')?.joinedLate, false);
});

test('roster facts follow a division’s top cut, as the player’s own pod does', () => {
  check(juniorsCutApart());
});
