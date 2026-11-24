/**
 * A round's tables, for players and staff alike. Each row is the table, the
 * two players with the record they brought into the round, and a mark by
 * whoever won; an open table has no mark yet. The public page leads with the
 * tables in progress, and while a table has extra time a desktop Status
 * column counts it down. Staff get the result controls: a player's name is the button that
 * reports them as the winner, which is one press at the table (and a second
 * to confirm, or a double click on an open table, see RoundPanel).
 *
 * On a phone a row restacks into two lines under its table number, as the
 * site's live pairings do, so the opponent is never behind a sideways scroll.
 */

import { createMemo, createSelector, createSignal, For, Index, type JSX, Show } from 'solid-js';
import { sortMatches } from '../../../shared/tournament/rounds';
import { isBye } from '../../../shared/tournament/standings';
import type { Match, Outcome, Pod, Round } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { t } from '../../lib/i18n';
import {
  markText,
  podLabel,
  recordsSoFar,
  roundLabel,
  seatMark,
  type SeatTag,
  shownOutcome
} from '../../lib/tournament/present';
import { PendingSeatMark } from './PendingSeatMark';
import { DeckIcons } from './DeckIcons';
import { ExtensionClock } from './ExtensionClock';
import { Icon } from '@ciphermaniac/design/components/Icon';

export interface MatchTableProps {
  pod: Pod;
  round: Round;
  matches: readonly Match[];
  names: Map<string, string>;
  decks: Record<string, string>;
  pending: readonly PendingResult[];
  /** The viewer's own player ID, whose row is marked. */
  me?: string | null;
  onPlayer?: (id: string) => void;
  /** The players whose name opens a pasted list, marked beside it. */
  listed?: ReadonlySet<string>;
  /** Staff only: report `outcome` for the match. */
  onReport?: (match: Match, outcome: Outcome) => void;
  /** Staff only: record `outcome` at once, from a double click on the winner at an open table. */
  onRecord?: (match: Match, outcome: Outcome) => void;
  /** Staff only: the extra cell at the end of each row. */
  extra?: (match: Match) => JSX.Element;
  /** Staff only: a player’s report, used for the pending result mark. */
  tag?: (match: Match, id: string) => SeatTag | null;
  /** The public page: the viewer's own row flagged, and each open table's extra time, with its clock on desktop. */
  status?: boolean;
  /** The result waiting for staff to confirm it, previewed in its row. */
  confirming?: { table: number; p1: string; outcome: Outcome } | null;
  /** Staff only: the result sent for a match and not answered yet, previewed the same way until it is. */
  sent?: (match: Match) => Outcome | undefined;
  /**
   * Whether a table is still in progress. Given, the tables in progress lead
   * under their own heading and the finished follow under theirs, while the
   * round has some of each.
   */
  inProgress?: (match: Match) => boolean;
  /** The one row a filter or search that leaves no tables shows, rather than a bare head. */
  empty?: JSX.Element;
  /** Staff only, where rows are too narrow for their controls: the whole row opens the table's result sheet. */
  onRow?: (match: Match) => void;
}

const winnerOutcome = (seat: 1 | 2): Outcome => (seat === 1 ? 'p1' : 'p2');

type Shown = ReturnType<typeof shownOutcome>;

/** The props a row's cells take: the table's, its match, what stands for the match, and whether it is the one confirming (see MatchTable). */
type CellProps = MatchTableProps & {
  match: Match;
  shownOf: (match: Match) => Shown;
  isConfirming: (match: Match) => boolean;
};

function SeatCell(props: CellProps & { seat: 1 | 2; records: Map<string, string> }) {
  const id = () => (props.seat === 1 ? props.match.p1 : props.match.p2);
  const shown = () => {
    const preview = props.isConfirming(props.match) ? props.confirming?.outcome : props.sent?.(props.match);
    return preview ? { outcome: preview, unconfirmed: true } : props.shownOf(props.match);
  };
  const mark = () => seatMark(shown().outcome, props.seat);
  const name = (playerId: string) => props.names.get(playerId) ?? playerId;
  const content = (playerId: string) => (
    <>
      <DeckIcons label={props.decks[playerId]} />
      <span class='tm-seat-name'>
        <span class='tm-name'>{name(playerId)}</span>
        <Show when={props.status && playerId === props.me}>
          <span class='tm-flag is-you'>{t('You')}</span>
        </Show>
        <Show when={props.listed?.has(playerId)}>
          <span class='tm-list-mark'>
            <Icon name='list' label={t('Decklist')} />
          </span>
        </Show>
      </span>
      <span class='muted-cell tm-record'>{props.records.get(playerId) ?? ''}</span>
    </>
  );
  const reportable = () => props.onReport && props.match.p2 !== null;
  // A double click records only on an open table: changing a result that stands always asks first.
  const open = () => (props.sent?.(props.match) ?? props.shownOf(props.match).outcome) === 'pending';
  return (
    <td class='tm-seat'>
      <Show
        when={id()}
        fallback={<span class='muted-cell'>{isBye(props.match.outcome) ? t('Bye') : t('Missed round')}</span>}
      >
        {playerId => (
          <span class='tm-seat-inner'>
            <PendingSeatMark
              enabled={Boolean(props.tag)}
              mark={mark()}
              unconfirmed={shown().unconfirmed}
              tag={props.tag?.(props.match, playerId()) ?? null}
              opponentTag={props.tag?.(props.match, props.seat === 1 ? (props.match.p2 ?? '') : props.match.p1) ?? null}
            >
              <span
                class='tm-mark'
                classList={{
                  'is-win': mark() === 'W',
                  'is-loss': mark() === 'L',
                  'is-unconfirmed': shown().unconfirmed
                }}
              >
                {markText(mark())}
                <Show when={mark() && shown().unconfirmed}>
                  <span class='sr-only'> {t('(not yet confirmed)')}</span>
                </Show>
              </span>
            </PendingSeatMark>
            {/* A name a press does nothing with reads as text, not as a button. */}
            <Show
              when={reportable() || props.onPlayer}
              fallback={
                <span class='tm-seat-link' classList={{ 'is-winner': mark() === 'W' }}>
                  {content(playerId())}
                </span>
              }
            >
              <button
                type='button'
                class='tm-seat-link'
                classList={{ 'is-winner': mark() === 'W' }}
                aria-label={reportable() ? t('Report {name} as the winner', { name: name(playerId()) }) : undefined}
                onClick={() =>
                  reportable() ? props.onReport?.(props.match, winnerOutcome(props.seat)) : props.onPlayer?.(playerId())
                }
                onDblClick={() => reportable() && open() && props.onRecord?.(props.match, winnerOutcome(props.seat))}
              >
                {content(playerId())}
              </button>
            </Show>
          </span>
        )}
      </Show>
    </td>
  );
}

/** A table's extra time under its number, where a phone hides the Status column. */
function PhoneExtension(props: { minutes: number }) {
  return (
    <span class='tm-table-extra'>
      <span aria-hidden='true'>+{props.minutes}</span>
      <span class='sr-only'>{t('{minutes} extra minutes', { minutes: props.minutes })}</span>
    </span>
  );
}

/**
 * The tables in their order, or split into those in progress and those done
 * while the round has both. Held rows keep the group they had, so while any
 * has moved on (`labelled` false) the groups go unnamed rather than miscount.
 */
function grouped(
  matches: readonly Match[],
  playing: ((match: Match) => boolean) | undefined,
  labelled = true
): { label: string | null; matches: Match[] }[] {
  const sorted = sortMatches(matches);
  if (!playing) {
    return [{ label: null, matches: sorted }];
  }
  const open = sorted.filter(m => playing(m));
  const done = sorted.filter(m => !playing(m));
  return open.length && done.length
    ? [
        { label: labelled ? t('In progress · {count}', { count: open.length }) : null, matches: open },
        { label: labelled ? t('Done · {count}', { count: done.length }) : null, matches: done }
      ]
    : [{ label: null, matches: sorted }];
}

const matchKey = (match: Pick<Match, 'table' | 'p1'>) => `${match.table}|${match.p1}`;

/**
 * Which group each table is in, held while a mouse is over the tables: a
 * result entered there moves its table to Done only once the pointer leaves,
 * so the table under it is still the one it was. A table that turns up while
 * held, as the filter changes, takes its group as usual.
 */
function createHeldGroups(props: MatchTableProps) {
  const [held, setHeld] = createSignal<ReadonlyMap<string, boolean> | null>(null);
  // With the round, since the next one, paired under the pointer, can seat the same player first at the same table.
  const key = (match: Match) => `${props.round.number}|${matchKey(match)}`;
  const shown = createMemo(() => {
    const live = props.inProgress;
    const groups = held();
    if (!live || !groups) {
      return grouped(props.matches, live);
    }
    const moved = props.matches.some(match => groups.get(key(match)) === !live(match));
    return grouped(props.matches, match => groups.get(key(match)) ?? live(match), !moved);
  });
  return {
    shown,
    hold: (event: PointerEvent) => {
      const live = props.inProgress;
      if (live && event.pointerType === 'mouse') {
        setHeld(new Map(props.matches.map(match => [key(match), live(match)])));
      }
    },
    release: () => setHeld(null)
  };
}

export function MatchTable(props: MatchTableProps) {
  const groups = createHeldGroups(props);
  // Only the row confirming, and the one it moves from, draw again as it changes.
  const confirmingRow = createSelector(() => (props.confirming ? matchKey(props.confirming) : null));
  const isConfirming = (match: Match) => confirmingRow(matchKey(match));
  // What stands for each of the round's tables, worked out once a change rather than in every cell.
  const shown = createMemo(
    () => new Map(props.round.matches.map(match => [match, shownOutcome(match, props.pod, props.round, props.pending)]))
  );
  const shownOf = (match: Match) => shown().get(match) ?? shownOutcome(match, props.pod, props.round, props.pending);
  const records = createMemo(() => recordsSoFar(props.pod, props.round, match => shownOf(match).outcome));
  const hasDecks = () => Object.keys(props.decks).length > 0;
  const extended = (match: Match) => shownOf(match).outcome === 'pending' && match.timeExtension;
  // The public page's Status column, only while an open table has extra time to count down.
  const timed = () => props.status && !props.extra && props.matches.some(extended);
  const columns = () => 3 + (props.extra || timed() ? 1 : 0);
  const mine = (match: Match) => props.me != null && (match.p1 === props.me || match.p2 === props.me);
  return (
    <div
      class='table-wrap tm-matches'
      classList={{ 'has-extra': Boolean(props.extra), 'has-decks': hasDecks() }}
      onPointerEnter={event => groups.hold(event)}
      onPointerLeave={() => groups.release()}
    >
      <table class='data'>
        <caption class='sr-only'>
          {t('{round} pairings, {division}', {
            round: roundLabel(props.round, props.pod),
            division: podLabel(props.pod)
          })}
        </caption>
        <thead>
          <tr>
            <th scope='col' class='num tm-table-col'>
              {t('Table')}
            </th>
            <th scope='col'>{t('Player')}</th>
            <th scope='col'>{t('Opponent')}</th>
            <Show when={props.extra}>
              <th scope='col' class='tm-extra-col'>
                {t('Result')}
              </th>
            </Show>
            <Show when={timed()}>
              <th scope='col' class='tm-status-col'>
                {t('Status')}
              </th>
            </Show>
          </tr>
        </thead>
        <tbody>
          <Show when={props.matches.length === 0 && props.empty}>
            {empty => (
              <tr class='tm-empty-row'>
                <td class='muted-cell' colSpan={columns()}>
                  {empty()}
                </td>
              </tr>
            )}
          </Show>
          <Index each={groups.shown()}>
            {group => (
              <>
                <Show when={group().label}>
                  {label => (
                    <tr class='tm-group-row'>
                      <th scope='colgroup' colSpan={columns()}>
                        {label()}
                      </th>
                    </tr>
                  )}
                </Show>
                <For each={group().matches}>
                  {match => (
                    <tr
                      classList={{
                        'is-me': mine(match),
                        'is-confirming': isConfirming(match),
                        'is-openable': Boolean(props.onRow) && match.p2 !== null
                      }}
                      onClick={event =>
                        match.p2 !== null && !(event.target as Element).closest('a') && props.onRow?.(match)
                      }
                    >
                      <td
                        class='num muted-cell tm-table-col'
                        classList={{ 'is-bye': !match.table }}
                        data-label={match.table ? t('Table') : t('Bye')}
                      >
                        <span class='tm-table-num'>{match.table || '—'}</span>
                        <Show when={props.status && extended(match)}>
                          {extension => <PhoneExtension minutes={extension().seconds / 60} />}
                        </Show>
                      </td>
                      <SeatCell
                        {...props}
                        match={match}
                        shownOf={shownOf}
                        isConfirming={isConfirming}
                        seat={1}
                        records={records()}
                      />
                      <SeatCell
                        {...props}
                        match={match}
                        shownOf={shownOf}
                        isConfirming={isConfirming}
                        seat={2}
                        records={records()}
                      />
                      <Show when={props.extra}>{extra => <td class='tm-extra-col'>{extra()(match)}</td>}</Show>
                      <Show when={timed()}>
                        <td class='tm-status-col'>
                          <Show when={extended(match)}>
                            <ExtensionClock match={match} round={props.round} playing />
                          </Show>
                        </td>
                      </Show>
                    </tr>
                  )}
                </For>
              </>
            )}
          </Index>
        </tbody>
      </table>
    </div>
  );
}
