/**
 * The public player sheet's data as the words and sprites its share image
 * draws: the name, place and deck the sheet heads with, its four figures, and
 * every finished round in order. Decks come only from the public page's own
 * map, so a deck the page hides is never drawn.
 * @module lib/shareImage/playerShare
 */

import { isBye, percentLabel, recordLabel, type Standing, thirdPlaceMatch } from '../../../shared/tournament/standings';
import type { Pod } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { ordinal } from '../format';
import { t } from '../i18n';
import { eventDay } from '../tournament/history';
import { bracketSize, type HistoryRow, markText, matchHistory } from '../tournament/present';
import type { PlayerShare, ShareDeck, ShareMark, ShareRound } from './headBar';

/** What the sheet shows, as PlayerSheet has it. */
export interface SheetData {
  readonly view: TournamentView;
  readonly pod: Pod;
  readonly playerId: string;
  readonly standing: Standing;
  /** Where they stand, as "2nd in Masters". */
  readonly place: string;
  readonly names: ReadonlyMap<string, string>;
  readonly records: ReadonlyMap<string, string>;
  /** Each player's deck, where the public page shows it. */
  readonly decks: Readonly<Record<string, string>>;
  /** A deck's sprites as the page draws them. */
  readonly sprites: (label: string) => readonly string[];
}

function deckOf(data: SheetData, playerId: string): ShareDeck | null {
  const label = data.decks[playerId];
  return label ? { label, sprites: data.sprites(label) } : null;
}

/**
 * A top cut round as a narrow column writes it: "Top 8" by the players still
 * in, "Final", and the match for third as "3rd", which fits where its name would not.
 */
function cutLabel(pod: Pod, number: number, playerId: string): string {
  const round = pod.rounds.find(entry => entry.number === number);
  const third = round && thirdPlaceMatch(pod, round);
  if (third && (third.p1 === playerId || third.p2 === playerId)) {
    return ordinal(3);
  }
  const players = round ? bracketSize(pod, round) * 2 : 2;
  return players <= 2 ? t('Final') : t('Top {n}', { n: players });
}

function shareRound(data: SheetData, row: HistoryRow & { mark: ShareMark }): ShareRound {
  const cut = row.kind === 'elimination';
  const { opponent } = row;
  return {
    label: cut ? cutLabel(data.pod, row.round, data.playerId) : String(row.round),
    cut,
    opponent: opponent
      ? {
          name: data.names.get(opponent) ?? '',
          record: data.records.get(opponent) ?? '',
          deck: deckOf(data, opponent)
        }
      : null,
    note: isBye(row.outcome) ? t('Bye') : t('Missed round'),
    mark: row.mark,
    letter: markText(row.mark)
  };
}

const finished = (row: HistoryRow): row is HistoryRow & { mark: ShareMark } => row.mark !== '';

/** The share image's words, formatted, from what the player's sheet shows. A round still playing is left out. */
export function playerShare(data: SheetData): PlayerShare {
  const { view, standing } = data;
  return {
    event: view.tournament.info.name,
    date: eventDay(view.settings.startsAt, view.tournament.info.startDate),
    name: data.names.get(data.playerId) ?? '',
    place: data.place,
    deck: deckOf(data, data.playerId),
    record: recordLabel(standing.record),
    points: String(standing.points),
    owp: percentLabel(standing.owp),
    oowp: percentLabel(standing.oowp),
    rounds: matchHistory(data.pod, data.playerId)
      .filter(finished)
      .map(row => shareRound(data, row))
  };
}
