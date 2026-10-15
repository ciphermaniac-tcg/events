/**
 * A standalone (unsanctioned) event's .tdf, the only copy of it an organizer
 * without TOM can keep: read back, it has the same roster, rounds and results,
 * and an event ended early still downloads, unfinalized.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import { isGeneratedId, type Tournament } from '../../shared/tournament/types.ts';
import { tdfFilename, tdfText } from '../../src/lib/tournament/exportTdf.ts';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(5)
    });
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.tournament;
  }, tournament);
}

function reportAll(t: Tournament): Tournament {
  const round = t.pods[0]!.rounds.at(-1)!;
  return run(
    t,
    ...round.matches
      .filter(m => m.p2 !== null && m.outcome === 'pending')
      .map((m, i): Command => ({
        type: 'reportResult',
        pod: t.pods[0]!.category,
        round: round.number,
        ...m,
        outcome: i % 3 === 2 ? 'tie' : 'p1'
      }))
  );
}

const players: Command[] = Array.from({ length: 7 }, (_, i) => ({
  type: 'addPlayer',
  player: { firstName: `Player${i + 1}`, lastName: 'Local' }
}));
const roundOne = reportAll(
  run(emptyTournament({ name: 'Friday Night' }), ...players, { type: 'pairRound', pod: 'masters' })
);
const dropped = run(roundOne, { type: 'dropPlayer', id: roundOne.players[0]!.id });
const played = reportAll(run(dropped, { type: 'pairRound', pod: 'masters' }));

/** What the organizer needs back from the file: who played, and every round's tables and results. */
const record = (t: Tournament) => ({
  players: t.players
    .map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, droppedAfter: p.droppedAfter }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  rounds: t.pods.flatMap(pod =>
    pod.rounds.map(round => ({
      number: round.number,
      kind: round.kind,
      matches: round.matches.map(({ table, p1, p2, outcome }) => ({ table, p1, p2, outcome }))
    }))
  )
});

test('a standalone event read back from its .tdf has its roster, rounds and results', () => {
  assert.ok(
    played.players.every(p => isGeneratedId(p.id)),
    'players without Player IDs'
  );
  const back = parseTdf(tdfText({ tournament: played, pending: [], finished: false }));
  assert.deepEqual(record(back), record(played));
  assert.equal(record(back).rounds.length, 2);
});

test('an event ended with a table open downloads unfinalized, and one played out finalized', () => {
  const open = run(played, { type: 'pairRound', pod: 'masters' });
  const early = tdfText({ tournament: open, pending: [], finished: true });
  assert.doesNotMatch(early, /<standings>/);
  assert.deepEqual(record(parseTdf(early)), record(open));
  assert.match(tdfText({ tournament: played, pending: [], finished: true }), /<standings>/);
});

test('the file is named for the event and the version it is a copy of', () => {
  assert.equal(tdfFilename(played, 14), 'Friday Night v14.tdf');
  assert.equal(tdfFilename(played), 'Friday Night.tdf');
});
