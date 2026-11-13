/**
 * What one organizer action changes in the stored event, used by staff commands. Player reports require staff acceptance.
 *
 * A Swiss event applies the command to the document. A TOM-run event takes
 * the round clock only, which is the site's (see shared/tournament/tomClock.ts):
 * TOM owns its pairings and results, and a result entered here would be one
 * TOM never reads. A player who drops mid-round from an unreported Swiss
 * match concedes it, and their opponent gets the win at once (see conceded).
 */

import { applyCommand as applySiteClock } from '../../../shared/tournament/legacyCommands.js';
import { applyCommand, type Command, type CommandContext } from '../../../shared/tournament/commands.js';
import { reportsFor } from '../../../shared/tournament/reports.js';
import { lockedRound } from '../../../shared/tournament/corrections.js';
import { checkInError } from '../../../shared/tournament/checkins.js';
import { countsComplete, findMatch, hasStarted, latestRound, podOf } from '../../../shared/tournament/rounds.js';
import { withSiteClocks } from '../../../shared/tournament/tomClock.js';
import type { PodCategory, Tournament } from '../../../shared/tournament/types.js';
import { applyPending, isSanctioned } from '../../../shared/tournament/view.js';
import { commandContext } from './commandContext.js';
import { type Changes, type TournamentRow } from './store.js';
import { msg } from '../../../shared/i18n.js';

/** What a TOM-run event takes from the site: the round clock, which the site runs. Results are TOM's. */
const TOM_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'startClock',
  'stopClock',
  'adjustClock',
  'setTimeExtension'
]);

/** Why a finished event takes no command: its results stand until the organizer reopens it. */
export const FINISHED_REFUSAL = msg('The event has ended; reopen it to make changes');

/**
 * What a finished event still takes: its name and round lengths, which change
 * no result. Its date or kind would (the date sets the season, and with it
 * every player's division), so they wait for a reopening like the rest.
 */
const ENDED_DETAILS: ReadonlySet<string> = new Set(['name', 'roundTime', 'finalsRoundTime']);

const takesOnceEnded = (command: Command) =>
  command.type === 'updateInfo' && Object.keys(command.info).every(key => ENDED_DETAILS.has(key));

/** Why a result is refused when another device changed it since the sender looked. */
const STALE_RESULT = msg('This result was changed on another device. Check it and enter yours again.');

/**
 * Whether a result expected another outcome than the one standing now. A
 * console that sends no expectation is taken as before.
 */
function isStale(row: TournamentRow, command: Extract<Command, { type: 'reportResult' }>): boolean {
  if (command.expected === undefined) {
    return false;
  }
  const standing = findMatch(row.tournament, command)?.match.outcome;
  return standing !== undefined && standing !== command.expected;
}

/** The changes `command` makes, or why it cannot run. */
/** Why the event does not take the command at all, or null: it has ended, TOM runs it, the round is locked, or a result is stale. */
function commandRefusal(row: TournamentRow, command: Command): string | null {
  if (row.settings.finished && !takesOnceEnded(command)) {
    return FINISHED_REFUSAL;
  }
  if (row.mode === 'tom') {
    return TOM_COMMANDS.has(command.type) ? null : msg('Please make this change in TOM.');
  }
  if (command.type === 'reportResult' && isStale(row, command)) {
    return STALE_RESULT;
  }
  if (command.type === 'pairRound') {
    return pairingRefusal(row, command.pod);
  }
  // On the site, a round whose records locked stays locked, even if deleting the rounds after it made it the
  // latest again (TOM keeps its own events' records).
  return command.type === 'reportResult' ? lockedRound(row.pairedThrough?.[command.pod] ?? 0, command.round) : null;
}

/**
 * Round 1 waits on staff checking in everyone still in (see
 * shared/tournament/checkins.ts); a later round waits on the one before, so
 * two staff pressing Pair at once cannot pair over a round still playing.
 */
function pairingRefusal(row: TournamentRow, pod: PodCategory): string | null {
  if (!hasStarted(row.tournament)) {
    return checkInError(row, row.tournament.players, row.checkins);
  }
  const round = latestRound(row.tournament.pods.find(p => p.category === pod));
  return round && !countsComplete(round) ? msg('This round still has results to enter.') : null;
}

/** The started Swiss match `id` left open by departing, with the opponent still in it; null for any other. */
function departedMatch(tournament: Tournament, id: string) {
  const pod = podOf(tournament, id);
  const round = latestRound(pod);
  const match = round?.matches.find(m => m.outcome === 'pending' && (m.p1 === id || m.p2 === id));
  const opponent = match?.p1 === id ? match.p2 : match?.p1;
  const stillIn = tournament.players.some(player => player.id === opponent && player.droppedAfter === null);
  return pod && round?.kind === 'swiss' && (round.stage ?? 4) >= 4 && match && stillIn ? { pod, round, match } : null;
}

/**
 * A player who drops, or is disqualified, during a Swiss round concedes a
 * match nobody has reported: the opponent gets the win, entered as staff
 * would enter it (Tournament Rules Handbook §5.7.1). A match with a result or
 * any player's report is left for staff, as is one whose opponent has left.
 * Elimination matches the engine concedes itself (see lifecyclePlayers.ts).
 */
function conceded(row: TournamentRow, command: Command, after: Tournament, ctx: CommandContext): Tournament {
  const id = command.type === 'dropPlayer' || command.type === 'disqualifyPlayer' ? command.id : null;
  const open = id === null ? null : departedMatch(after, id);
  if (!open || reportsFor(row.reports, open.pod.category, open.round.number, open.match).length > 0) {
    return after;
  }
  const { table, p1, p2 } = open.match;
  const outcome = p1 === id ? 'p2' : 'p1';
  const win = applyCommand(
    after,
    { type: 'reportResult', pod: open.pod.category, round: open.round.number, table, p1, p2, outcome },
    ctx
  );
  return win.ok ? win.tournament : after;
}

export function commandChanges(row: TournamentRow, command: Command, localTime: unknown): Changes | string {
  const refusal = commandRefusal(row, command);
  if (refusal) {
    return refusal;
  }
  const apply = row.mode === 'tom' ? applySiteClock : applyCommand;
  const source = commandSource(row, command);
  const ctx = commandContext(row.tournament, localTime, isSanctioned(row));
  const result = apply(source, command, ctx);
  if (!result.ok) {
    return result.tournament ? { tournament: result.tournament, refusal: result.error } : result.error;
  }
  if (row.mode === 'tom') {
    // A clock may change only the clock: anything more is a copy the next file sync would be refused against.
    return { tournament: withSiteClocks(row.tournament, result.tournament) };
  }
  return { tournament: conceded(row, command, result.tournament, ctx) };
}

function commandSource(row: TournamentRow, command: Command): Tournament {
  return row.mode === 'tom' && command.type === 'setTimeExtension'
    ? applyPending(row.tournament, row.pending)
    : row.tournament;
}
