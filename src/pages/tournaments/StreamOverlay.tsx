/**
 * One table for a stream (`/t/:code?stream=table&table=N`, with `&pod=` to
 * pick a division where several play): the two players with their decks and
 * records, the round and its clock, and once the table is done, who won. Its
 * page is transparent around one bar, so a browser source in OBS lays it over
 * the game as it is; it follows the table into each new round on its own.
 * `&scale=` sizes the bar for a producer's own layout.
 */

import { createMemo, Show, useContext } from 'solid-js';
import type { Match, PodCategory, Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { cutSeeds } from '../../lib/tournament/bracket';
import { markText, namesById, recordsSoFar, roundLabel, seatMark, shownOutcome } from '../../lib/tournament/present';
import { msg, t } from '../../lib/i18n';
import { streamDecks, streamTable } from '../../lib/tournament/spectate';
import { withSwiss } from '../../../shared/tournament/rounds';
import { Clock, StaleSince } from './Clock';
import { DeckIcons } from './DeckIcons';
import '../../styles/pages/tournament-stream.css';

const MARK_WORDS: Record<string, string> = { W: msg('Won'), L: msg('Lost'), T: msg('Tie') };

function StreamSeat(props: {
  name: string;
  deck: string | undefined;
  record: string;
  seed: number | undefined;
  mark: string;
  side: 'left' | 'right';
}) {
  return (
    <div
      class={`tm-stream-seat is-${props.side}`}
      classList={{ 'is-win': props.mark === 'W', 'is-out': props.mark === 'L' }}
    >
      <DeckIcons label={props.deck} size={36} />
      <div class='tm-stream-who'>
        <span class='tm-stream-name'>
          <Show when={props.seed}>{seed => <small class='num'>{seed()}</small>}</Show>
          {props.name}
        </span>
        <span class='tm-stream-detail num'>{[props.record, props.deck].filter(Boolean).join(' · ')}</span>
      </div>
      <Show when={props.mark}>
        {mark => (
          <span class='tm-stream-mark' aria-label={t(MARK_WORDS[mark()] ?? mark())}>
            {markText(mark())}
          </span>
        )}
      </Show>
    </div>
  );
}

/**
 * The audience can do nothing about a lost connection, so the overlay never
 * says so: its clock stops where it was last known to be and goes quiet,
 * and the poll keeps trying on its own.
 */
export function StreamOverlay(props: { view: TournamentView; table: number; pod?: PodCategory; scale?: number }) {
  const stale = useContext(StaleSince);
  const shown = createMemo(() => streamTable(props.view.tournament, props.table, props.pod));
  const names = createMemo(() => namesById(props.view.tournament));
  const decks = createMemo(() => streamDecks(props.view));
  return (
    <div class='tm-stream' style={{ '--tm-stream-scale': props.scale ?? 1 }}>
      <Show
        when={shown()}
        fallback={
          <div class='tm-stream-bar is-empty'>
            <span>{t('Table {n} is not in play', { n: props.table })}</span>
          </div>
        }
      >
        {table => {
          const played = () => withSwiss(props.view.tournament, table().pod);
          const outcomeOf = (match: Match) =>
            shownOutcome(match, table().pod, table().round, props.view.pending).outcome;
          const records = () => recordsSoFar(played(), table().round, outcomeOf);
          const seeds = () =>
            table().round.kind === 'elimination' ? cutSeeds(props.view.tournament, table().pod) : new Map();
          const outcome = () => outcomeOf(table().match);
          const extra = () => table().match.timeExtension?.seconds;
          const mark = (seat: 1 | 2) => (table().match.p2 === null ? '' : seatMark(outcome(), seat));
          const seat = (id: string | null, side: 'left' | 'right') => (
            <StreamSeat
              name={id ? (names().get(id) ?? id) : t('Bye')}
              deck={id ? decks()[id] : undefined}
              record={id ? (records().get(id) ?? '') : ''}
              seed={id ? seeds().get(id) : undefined}
              mark={mark(side === 'left' ? 1 : 2)}
              side={side}
            />
          );
          return (
            <div class='tm-stream-bar' classList={{ 'is-stale': stale() !== null }}>
              {seat(table().match.p1, 'left')}
              <div class='tm-stream-mid'>
                <span class='tm-stream-round'>{roundLabel(table().round, table().pod)}</span>
                <span class='tm-stream-table num'>{t('Table {n}', { n: props.table })}</span>
                {/* The table's own time, extension and all, until it has a result. */}
                <Show when={!props.view.settings.finished && outcome() === 'pending'}>
                  <Clock round={table().round as Round} extraSeconds={extra()} class='tm-stream-clock' />
                  <Show when={extra()}>
                    {seconds => (
                      <span class='tm-stream-extra num'>{t('+{minutes} min', { minutes: seconds() / 60 })}</span>
                    )}
                  </Show>
                </Show>
              </div>
              {seat(table().match.p2, 'right')}
            </div>
          );
        }}
      </Show>
    </div>
  );
}
