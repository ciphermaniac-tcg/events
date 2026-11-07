/**
 * A player entered late in TOM while a round is paired: TOM pairs that round
 * again, which takes back the bye it had given. The file it saves is newer
 * than the site's copy, and the console must send it rather than hold it back
 * as an older copy. The fixtures are TOM 1.86's own saves, from the
 * conformance corpus (v10-repair-twice-same-round, 0010 and 0012).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { olderThan } from '../../shared/tournament/revision.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';

const fixture = (name: string) => parseTdf(readFileSync(new URL(`../fixtures/tdf/${name}`, import.meta.url), 'utf8'));

/** Round two paired with a bye, a latecomer already in with a forced loss for round one. */
const PAIRED = fixture('tom-186-late-round-two-bye.tdf');
/** The same round after a second latecomer: paired again, the bye gone, a second forced loss in round one. */
const REPAIRED = fixture('tom-186-late-round-two-repaired.tdf');

const roundOf = (tournament: Tournament, number: number) =>
  tournament.pods[0]!.rounds.find(round => round.number === number)!;

test('a TOM file with players entered after round one reads and passes the site’s checks', () => {
  for (const file of [PAIRED, REPAIRED]) {
    const late = file.players.filter(player => player.starter !== true);
    assert.ok(late.length > 0, 'the file has a latecomer');
    const losses = roundOf(file, 1).matches.filter(m => m.outcome === 'loss');
    assert.deepEqual(
      losses.map(m => m.p1).sort(),
      late.map(p => p.id).sort(),
      'each latecomer has a forced loss for round one'
    );
    assert.ok(readTournament(JSON.parse(JSON.stringify(file)) as unknown));
  }
});

test('a round TOM paired again for a latecomer is not an older copy for the bye it took back', () => {
  assert.ok(roundOf(PAIRED, 2).matches.some(m => m.outcome === 'bye'));
  assert.ok(!roundOf(REPAIRED, 2).matches.some(m => m.outcome === 'bye'));
  assert.equal(olderThan(REPAIRED, PAIRED), false);
});

test('a file that lacks an entered result is still an older copy', () => {
  const played = roundOf(REPAIRED, 1).matches.find(m => m.p2 !== null && m.outcome !== 'pending')!;
  const unplayed: Tournament = {
    ...REPAIRED,
    pods: REPAIRED.pods.map(pod => ({
      ...pod,
      rounds: pod.rounds.map(round => ({
        ...round,
        matches: round.matches.map(m => (m === played ? { ...m, outcome: 'pending' as const } : m))
      }))
    }))
  };
  assert.equal(olderThan(unplayed, REPAIRED), true);
});
