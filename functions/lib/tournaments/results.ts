/**
 * What one organizer action changes in the stored event, used by staff commands. Player reports require staff acceptance.
 *
 * A Swiss event applies the command to the document. A TOM-run event takes
 * results and the round clock: TOM owns its pairings, so a result entered here
 * is held as pending and shown until the .tdf that TOM writes has its own,
 * while the clock is the site's (see shared/tournament/tomClock.ts).
 */

import { applyCommand as applySiteClock } from '../../../shared/tournament/legacyCommands.js';
import { applyCommand, type Command } from '../../../shared/tournament/commands.js';
import { lockedRound } from '../../../shared/tournament/corrections.js';
import { checkInError } from '../../../shared/tournament/checkins.js';
import { countsComplete, findMatch, hasStarted, isOpenMatch, latestRound } from '../../../shared/tournament/rounds.js';
import { withSiteClocks } from '../../../shared/tournament/tomClock.js';
import type { PodCategory, Tournament } from '../../../shared/tournament/types.js';
import { applyPending, isSanctioned, prunePending, withPending } from '../../../shared/tournament/view.js';
import { commandContext } from './commandContext.js';
import { type Changes, type TournamentRow } from './store.js';
import { msg } from '../../../shared/i18n.js';

/**
 * A result for TOM to take in. Only an open match takes one: TOM's own result
 * wins over anything written here, so a correction would never land.
 */
function pendingChange(row: TournamentRow, command: Extract<Command, { type: 'reportResult' }>): Changes | string {
  if (!isOpenMatch(row.tournament, command)) {
    return msg('TOM already has a result for this match; change it in TOM');
  }
  const { pod: category, round, table, p1, p2, outcome } = command;
  const next = { pod: category, round, table, p1, p2, outcome, at: Date.now() };
  return { pending: withPending(prunePending(row.tournament, row.pending), next) };
}

/** What a TOM-run event takes from the site: results for TOM, and the round clock, which the site runs. */
const TOM_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'reportResult',
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
 * Whether a result expected another outcome than the one standing now,
 * pending results included. A console that sends no expectation is taken as
 * before, and a TOM match TOM has decided is refused for that instead (see
 * pendingChange).
 */
function isStale(row: TournamentRow, command: Extract<Command, { type: 'reportResult' }>): boolean {
  if (command.expected === undefined || (row.mode === 'tom' && !isOpenMatch(row.tournament, command))) {
    return false;
  }
  const standing = findMatch(applyPending(row.tournament, row.pending), command)?.match.outcome;
  return standing !== undefined && standing !== command.expected;
}

/** The changes `command` makes, or why it cannot run. */
/** Why the event does not take the command at all, or null: it has ended, TOM runs it, the round is locked, or a result is stale. */
function commandRefusal(row: TournamentRow, command: Command): string | null {
  if (row.settings.finished && !takesOnceEnded(command)) {
    return FINISHED_REFUSAL;
  }
  if (command.type === 'reportResult' && isStale(row, command)) {
    return STALE_RESULT;
  }
  if (row.mode === 'tom') {
    return TOM_COMMANDS.has(command.type) ? null : msg('Please make this change in TOM.');
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

export function commandChanges(row: TournamentRow, command: Command, localTime: unknown): Changes | string {
  const refusal = commandRefusal(row, command);
  if (refusal) {
    return refusal;
  }
  const apply = row.mode === 'tom' && command.type !== 'reportResult' ? applySiteClock : applyCommand;
  const source = commandSource(row, command);
  const result = apply(source, command, commandContext(row.tournament, localTime, isSanctioned(row)));
  if (!result.ok) {
    return result.tournament ? { tournament: result.tournament, refusal: result.error } : result.error;
  }
  if (row.mode === 'tom') {
    // A clock may change only the clock: anything more is a copy the next file sync would be refused against.
    return command.type === 'reportResult'
      ? pendingChange(row, command)
      : { tournament: withSiteClocks(row.tournament, result.tournament) };
  }
  return { tournament: result.tournament };
}

function commandSource(row: TournamentRow, command: Command): Tournament {
  return row.mode === 'tom' && command.type === 'setTimeExtension'
    ? applyPending(row.tournament, row.pending)
    : row.tournament;
}
