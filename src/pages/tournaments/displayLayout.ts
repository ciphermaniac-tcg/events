import { type DisplayOptions, type DisplayRoom, roomFeet, SCALE_LIMITS } from '../../../shared/tournament/display';
import type { Match, Pod, Round, Tournament } from '../../../shared/tournament/types';
import { latestRound, sortMatches } from '../../../shared/tournament/rounds';

export interface DisplaySize {
  width: number;
  height: number;
}

/** CSS pixels, not physical pixels: applying devicePixelRatio again would double the browser's DPI scaling. */
export function displayFont(size: DisplaySize, scale: number): number {
  return Math.round(Math.max(18, Math.min(96, Math.min(size.width / 60, size.height / 32))) * scale);
}

/**
 * The text size a room calls for. On a 16:9 screen the base text is the
 * screen's height over 33.75 (displayFont), and the screen's height is 0.49
 * of its diagonal. A capital letter (0.73 of the text size in Inter) reads
 * comfortably when it spans 12 minutes of arc, about two and a half times the
 * smallest letter 20/20 eyes make out. Rounded to 5% and kept within limits.
 */
export function roomScale(room: DisplayRoom): number {
  const baseInches = (room.inches * (9 / Math.hypot(16, 9))) / 33.75;
  const neededInches = (roomFeet(room) * 12 * Math.tan((12 / 60) * (Math.PI / 180))) / 0.73;
  const scale = Math.round((neededInches / baseInches) * 20) / 20;
  return Math.max(SCALE_LIMITS.min, Math.min(SCALE_LIMITS.max, scale));
}

/**
 * Number of legible rows/columns that fit the measured content area, leaving room for the pager. A seat in
 * alphabetical order is one name over its opponent's, narrower than a table's two names side by side.
 */
export function displayCapacity(
  size: DisplaySize,
  font: number,
  alphabetical = false
): { rows: number; columns: number; total: number } {
  const columns = Math.max(1, Math.min(3, Math.floor(size.width / (font * (alphabetical ? 15 : 24)))));
  const rows = Math.max(1, Math.floor((size.height - 56) / (font * 2.2)));
  return { rows, columns, total: rows * columns };
}

/** Pages only when a preset asks for them; otherwise the face-off list scrolls, however many tables there are. */
export const pagedDisplay = (options: DisplayOptions): boolean =>
  options.layout === 'tables' || options.layout === 'alphabetical';

export interface DisplayRow {
  pod: Pod;
  match: Match;
  round: Round;
  player: string;
  opponent: string | null;
}

/** Dense table rows, or one entry per seat in alphabetical order so each player can find their own name. */
export function displayRows(tournament: Tournament, pods: readonly Pod[], alphabetical: boolean): DisplayRow[] {
  const rows = pods.flatMap(pod =>
    sortMatches(latestRound(pod)?.matches ?? []).flatMap(match => {
      const round = latestRound(pod) as Round;
      const first = { pod, round, match, player: match.p1, opponent: match.p2 };
      return alphabetical && match.p2 ? [first, { pod, round, match, player: match.p2, opponent: match.p1 }] : [first];
    })
  );
  if (!alphabetical) {
    return rows;
  }
  // First name first, as the screen shows names and lists everyone registered: a published last name may be an initial.
  const names = new Map(tournament.players.map(player => [player.id, `${player.firstName} ${player.lastName}`]));
  return rows.sort(
    (a, b) =>
      (names.get(a.player) ?? a.player).localeCompare(names.get(b.player) ?? b.player) || a.match.table - b.match.table
  );
}
