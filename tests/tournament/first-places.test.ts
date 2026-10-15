/** Who won an event: first place in each division's final standings, as the Won badge counts it. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import { firstPlaces, parseTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { champions } from '../../src/lib/tournament/present.ts';
import { commandRunner, pendingResults } from '../__utils__/commands.ts';

const ctx = { now: Date.UTC(2026, 9, 4), localTime: '10/04/2026 10:00:00', season: 2027, random: seededRandom(7) };

const run = commandRunner(ctx);

function field(years: string[]): Tournament {
  return years.reduce(
    (t, year, i) =>
      run(t, {
        type: 'addPlayer',
        player: { id: String(100 + i), firstName: 'Sky', lastName: `Lark${i}`, birthDate: `05/10/${year}` }
      }),
    emptyTournament({ name: 'Synthetic Cup', startDate: '10/04/2026' })
  );
}

/** Every open match in each pod's latest round goes to its first seat. */
const complete = (t: Tournament): Tournament => run(t, ...t.pods.flatMap(pod => pendingResults(pod)));

test('an event with no top cut is won by whoever leads the Swiss standings', () => {
  let t = complete(run(field(['1990', '1990', '1990', '1990']), { type: 'pairRound', pod: 'masters' }));
  t = complete(run(t, { type: 'pairRound', pod: 'masters' }));
  const [leader] = swissStandings(t.pods[0]!, t.players);
  assert.deepEqual(firstPlaces(t), [leader!.playerId]);
});

test('a top cut’s final decides it, one winner for each division', () => {
  let t = field(['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990']);
  // Eight players play three Swiss rounds before the cut.
  for (let round = 0; round < 3; round += 1) {
    t = complete(run(t, { type: 'pairRound', pod: 'mixed' }));
  }
  t = run(t, { type: 'startTopCut', pod: 'mixed', division: 'junior', size: 4 });
  t = run(t, { type: 'startTopCut', pod: 'mixed', division: 'masters', size: 4 });
  t = complete(t);
  t = complete(run(t, { type: 'pairRound', pod: 'mixed' }));
  const finals = champions(latestRound(t.pods[0]), t.pods[0]!).map(c => c.id);
  assert.equal(finals.length, 2);
  assert.deepEqual([...firstPlaces(t)].sort(), [...finals].sort());
});

test('a TOM file’s own standings name the winners while the event stands as TOM left it', () => {
  const source = readFileSync(new URL('../fixtures/tdf/harness/combined/19-final.tdf', import.meta.url), 'utf8');
  assert.deepEqual([...firstPlaces(parseTdf(source))].sort(), ['1000015', '1000023', '1000034']);
});
