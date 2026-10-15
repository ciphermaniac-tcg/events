/**
 * Organizer commands as the tournament tests run them: each applied in turn,
 * a refusal failing the test. Every file passes its own context, since the
 * seed and the clock decide its pairings and so everything it asserts.
 */

import assert from 'node:assert/strict';

import {
  applyCommand,
  type Command,
  type CommandContext,
  type CommandResult
} from '../../shared/tournament/commands.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';

type Apply = (t: Tournament, command: Command, ctx: CommandContext) => CommandResult;

/** One context for every command, or one made for each from the document it applies to. */
type Context = CommandContext | ((t: Tournament) => CommandContext);

export function commandRunner(context: Context, apply: Apply = applyCommand) {
  return (tournament: Tournament, ...commands: Command[]): Tournament =>
    commands.reduce((current, command) => {
      const result = apply(current, command, typeof context === 'function' ? context(current) : context);
      assert.ok(result.ok, `${command.type}: ${result.ok ? '' : result.error}`);
      return result.tournament;
    }, tournament);
}

/** The same seed afresh for every command, as each request to the server draws its own. */
export function freshContext(seed: number, localTime: string, now = 0): () => CommandContext {
  return () => ({ now, localTime, season: 2027, random: seededRandom(seed) });
}

/** A report for every open match in the pod's current round, won by the first seat. */
export function pendingResults(pod: Pod): Command[] {
  const round = latestRound(pod);
  return (round?.matches ?? [])
    .filter(m => m.outcome === 'pending')
    .map(m => ({
      type: 'reportResult',
      pod: pod.category,
      round: round!.number,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1'
    }));
}
