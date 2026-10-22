/**
 * What a dropped player's return does, read before it is made: whether it is
 * offered at all, the round it gives them a bye for, whether it lifts a
 * disqualification, or why it is refused. Both engines make the return from
 * it (reenterEntrant in lifecyclePlayers.ts, undropPlayer in
 * legacyCommands.ts), and the roster asks it before offering one, so none of
 * them can disagree.
 */

import { latestRound, podOf } from './rounds.js';
import type { Pod, Round, Tournament } from './types.js';
import { msg, msgf } from '../i18n.js';

export interface ReturnEffects {
  /**
   * Whether the roster offers the return: while the player has missed no more
   * than a round, so a player dropped rounds ago carries no refused action. A
   * return that is offered can still be refused, saying why.
   */
  offered: boolean;
  /** The round the player gets a bye for, if any. */
  byeRound?: number;
  liftsDisqualification: boolean;
  /** Why the return is refused; nothing else is set when it is. */
  refusal?: string;
}

const seats = (round: Round, id: string) => round.matches.some(m => m.p1 === id || m.p2 === id);

/** The round the return's checks count from: a paired round not yet started is not missed. */
const pairedAdjustment = (round: Round | undefined): number => ((round?.stage ?? 4) < 4 ? 1 : 0);

function refusalFor(pod: Pod, id: string, hasHistory: boolean, absent: number): string | undefined {
  // V18-2: matches of a failed pairing attempt are history although unsaved, so V14b's return is refused.
  if (!hasHistory && pod.unsavedPlayers?.includes(id)) {
    return msg('A player whose only matches were not saved cannot return');
  }
  if (!hasHistory && (latestRound(pod)?.number ?? 0) >= 3) {
    return msg('A player without match history cannot return after round two');
  }
  return absent > 1 ? msg('A player cannot return after missing more than one round') : undefined;
}

/**
 * An event from before the lifecycle engine takes a player back with no bye,
 * until the next round is paired. After that the player has missed a pairing,
 * and letting them back in would hand them a loss they never played or a
 * round they were never in.
 */
function legacyReturn(t: Tournament, id: string, droppedAfter: number, liftsDisqualification: boolean): ReturnEffects {
  if (droppedAfter === (latestRound(podOf(t, id))?.number ?? 0)) {
    return { offered: true, liftsDisqualification };
  }
  const refusal = msgf('They dropped before round {round} was paired, so they can’t come back now', {
    round: droppedAfter + 1
  });
  return { offered: false, liftsDisqualification: false, refusal };
}

/**
 * The bye a returning player who has played is given: for the latest round
 * once it has started without them, or for the round after their last match
 * when that round came before the latest. One who never played has none.
 */
function byeFor(pod: Pod, id: string, played: number, absent: number): number | undefined {
  const last = latestRound(pod);
  if (!last) {
    return undefined;
  }
  if (absent >= 1 && played + 1 < last.number) {
    return played + 1;
  }
  return !seats(last, id) && (last.stage ?? 0) >= 4 ? last.number : undefined;
}

export function returnEffects(t: Tournament, id: string): ReturnEffects {
  const player = t.players.find(p => p.id === id);
  if (!player || player.droppedAfter === null) {
    return { offered: false, liftsDisqualification: false, refusal: msg('The player is not dropped') };
  }
  const liftsDisqualification = player.disqualified === true;
  // The return is made in the first pod that holds the player.
  const pod = t.pods.find(p => p.playerIds.includes(id));
  if (!t.settings || !pod) {
    return legacyReturn(t, id, player.droppedAfter, liftsDisqualification);
  }
  const history = pod.rounds.filter(round => seats(round, id));
  const hasHistory = history.length > 0;
  // Absence counts the rounds since the player last played, whichever round the departure saved.
  const played = hasHistory ? Math.max(...history.map(round => round.number)) : player.droppedAfter;
  const absent = (latestRound(pod)?.number ?? 0) - played - pairedAdjustment(latestRound(pod));
  const refusal = refusalFor(pod, id, hasHistory, absent);
  const offered = absent <= 1;
  if (refusal) {
    return { offered, liftsDisqualification: false, refusal };
  }
  const byeRound = hasHistory ? byeFor(pod, id, played, absent) : undefined;
  return { offered, liftsDisqualification, ...(byeRound === undefined ? {} : { byeRound }) };
}
