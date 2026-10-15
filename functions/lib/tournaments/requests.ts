/**
 * Players' requests to staff as row changes (see shared/tournament/requests.ts):
 * a player files or cancels their own, and staff answer one by its ID.
 */

import {
  answerRequest,
  cancelRequest,
  fileRequest,
  type RequestAnswer,
  type RequestKind
} from '../../../shared/tournament/requests.js';
import { commandChanges } from './results.js';
import type { Changes, TournamentRow } from './store.js';

const ALREADY_OUT = 'You’re already out of the event';

/** Whether the player has dropped, so a drop request asks for nothing. */
const dropped = (row: TournamentRow, player: string) =>
  (row.tournament.players.find(candidate => candidate.id === player)?.droppedAfter ?? null) !== null;

/**
 * The player's request of `kind`, filed or (`cancel`) cancelled; no change
 * when an open one already stands; or why it cannot be.
 */
export function playerRequestChanges(
  row: TournamentRow,
  ask: { id: string; player: string; kind: RequestKind; cancel: boolean; at: number }
): Changes | string {
  if (row.settings.finished) {
    return 'This event is over';
  }
  if (!ask.cancel && ask.kind === 'drop' && dropped(row, ask.player)) {
    return ALREADY_OUT;
  }
  const requests = ask.cancel ? cancelRequest(row.requests, ask) : fileRequest(row.requests, ask);
  if (requests === null) {
    return {};
  }
  return typeof requests === 'string' ? requests : { requests };
}

/**
 * Staff's answer to the open request `id`, by name and time; or why it cannot
 * be given. Confirming a drop at a Swiss event drops the player in the same
 * write, so the drop never lands without its answer or the answer without
 * its drop. A TOM event's roster is TOM's: there the answer is all.
 */
export function staffAnswerChanges(
  row: TournamentRow,
  answer: { id: string; status: RequestAnswer; by: string; at: number; localTime: unknown }
): Changes | string {
  const requests = answerRequest(row.requests, answer);
  if (typeof requests === 'string') {
    return requests;
  }
  const request = requests.find(candidate => candidate.id === answer.id);
  const drops = request?.kind === 'drop' && answer.status === 'accepted' && row.mode === 'swiss';
  if (!request || !drops || dropped(row, request.player)) {
    return { requests };
  }
  const drop = commandChanges(row, { type: 'dropPlayer', id: request.player }, answer.localTime);
  if (typeof drop === 'string') {
    return drop;
  }
  return drop.refusal ?? { ...drop, requests };
}
