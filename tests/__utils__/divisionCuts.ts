/**
 * An event whose divisions played Swiss together and cut apart (§5.2.1):
 * four Juniors and four Masters in one pod, then a Juniors top 4 played to
 * its final, and the Masters with no cut.
 */

import type { Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import type { PodCategory, Tournament } from '../../shared/tournament/types.ts';
import { commandRunner, freshContext, pendingResults } from './commands.ts';

const run = commandRunner(freshContext(5, '10/10/2026 10:00:00'));

/** Every open match in the pod's current round, won by the first seat. */
function reportAll(t: Tournament, category: PodCategory): Tournament {
  const pod = t.pods.find(candidate => candidate.category === category);
  return pod ? run(t, ...pendingResults(pod)) : t;
}

export function juniorsCutApart(): Tournament {
  const years = ['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990'];
  const adds = years.map(
    (year, i) =>
      ({
        type: 'addPlayer',
        player: { firstName: 'P', lastName: `${i}`, id: `${500 + i}`, birthDate: `02/27/${year}` }
      }) as Command
  );
  let t = run(emptyTournament({ name: 'Apart', startDate: '10/10/2026' }), ...adds, {
    type: 'pairRound',
    pod: 'mixed'
  });
  for (let i = 1; i < 3; i += 1) {
    t = run(reportAll(t, 'mixed'), { type: 'pairRound', pod: 'mixed' });
  }
  t = run(reportAll(t, 'mixed'), { type: 'startTopCut', pod: 'mixed', size: 4, division: 'junior' });
  t = run(reportAll(t, 'mixed'), { type: 'pairRound', pod: 'mixed' });
  return reportAll(t, 'mixed');
}
