/**
 * The .tdf for an event as the site has it: TOM's file with the results
 * entered here laid over it, or a Swiss event written out in TOM's layout.
 * An ended event's file is finalized once every match has its result; one
 * ended early is written as it stands, unfinalized.
 */

import { hasPendingMatches, writeTdf } from '../../../shared/tournament/tdf';
import type { Tournament } from '../../../shared/tournament/types';
import { applyPending, type PendingResult } from '../../../shared/tournament/view';

export interface ExportSource {
  tournament: Tournament;
  pending: readonly PendingResult[];
  finished: boolean;
}

export function tdfText(source: ExportSource): string {
  const tournament = applyPending(source.tournament, source.pending);
  return writeTdf(tournament, {
    finalized: (source.finished && !hasPendingMatches(tournament)) || undefined
  });
}

/** The file's name: the event's, and with `version`, which copy of the event it is. */
export function tdfFilename(tournament: Tournament, version?: number): string {
  const base =
    tournament.info.name
      .replace(/[^\w -]+/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'tournament';
  return version === undefined ? `${base}.tdf` : `${base} v${version}.tdf`;
}
