/**
 * One player as staff need them, opened from a name on the console's roster
 * or standings, or a roster row's Details: where they are now (their table
 * and opponent, or before round 1 their check-in), every round they played,
 * their decklist, the penalty notes and deck checks written about them, and
 * in the foot the actions their roster row offers, each asking first as it
 * does there. Built on the public player sheet's frame (see Sheet). A
 * pairing's names record results, so the sheet never opens from them.
 */

import { createMemo, createResource, For, type JSX, Match, Show, Switch } from 'solid-js';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { standingChecks } from '../../../shared/tournament/deckChecks';
import { decklistMatcher } from '../../../shared/tournament/identify';
import { divisionFor, eventSeason } from '../../../shared/tournament/divisions';
import { DECIDING_PENALTIES, PENALTY_LABELS, standingNotes } from '../../../shared/tournament/penaltyNotes';
import { hasStarted, playerPod, regularRounds } from '../../../shared/tournament/rounds';
import { recordLabel, swissStandings } from '../../../shared/tournament/standings';
import { DIVISION_LABELS, isGeneratedId, type Player, playerName, type Pod } from '../../../shared/tournament/types';
import { decklistsLocked, decksEnabled, isSanctioned } from '../../../shared/tournament/view';
import {
  type Decklist,
  fetchDeckChecks,
  fetchDecklists,
  fetchPenaltyNotes,
  type Manage
} from '../../lib/tournament/api';
import { type PlayerNow, playerNow } from '../../lib/tournament/playerNow';
import { matchHistory, namesById, roundLabel, shownDecks } from '../../lib/tournament/present';
import { intlLocale, t } from '../../lib/i18n';
import { CheckInMarks, showsCheckIn } from './CheckIn';
import { DeckIcons } from './DeckIcons';
import { RetryError } from './Field';
import { HistoryTable } from './HistoryTable';
import type { ManageState } from './manageState';
import { offersActions, PlayerActions } from './PlayerActions';
import { Sheet } from './Sheet';
import { Squares } from './Squares';

interface SheetProps {
  state: ManageState;
  manage: Manage;
  player: Player;
  onClose: () => void;
  /** Opens another player's sheet in its place, as an opponent's name does. */
  onPlayer: (id: string) => void;
}

/** What the sheet shares with each of its sections: the player, everyone's names and records, and the decks shown. */
interface Seen {
  props: SheetProps;
  names: () => Map<string, string>;
  records: () => Map<string, string>;
  decks: () => Record<string, string>;
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class='tm-sheet-section'>
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

/** A record staff read on a sheet, read once it opens: a skeleton until it comes, and a way to ask again if it fails. */
function Loaded<T>(props: {
  value: T | undefined;
  failed: boolean;
  error: string;
  onRetry: () => void;
  children: (value: () => T) => JSX.Element;
}) {
  return (
    <Switch fallback={<Skeleton height='40px' />}>
      <Match when={props.failed}>
        <div class='tm-row-actions'>
          <RetryError error={props.error} onRetry={() => props.onRetry()} small />
        </div>
      </Match>
      <Match when={props.value}>{value => props.children(value)}</Match>
    </Switch>
  );
}

/** An opponent's name, which opens their sheet, with their deck and record. */
function Opponent(props: { seen: Seen; id: string }) {
  return (
    <button type='button' class='tm-seat-link' onClick={() => props.seen.props.onPlayer(props.id)}>
      <DeckIcons label={props.seen.decks()[props.id]} />
      <span class='tm-name'>{props.seen.names().get(props.id)}</span>
      <span class='muted-cell tm-record'>{props.seen.records().get(props.id) ?? ''}</span>
    </button>
  );
}

const outLine = (now: Extract<PlayerNow, { kind: 'out' }>) =>
  now.disqualified
    ? t('Disqualified after round {round}', { round: now.after })
    : t('Dropped after round {round}', { round: now.after });

/** The player's state now, when it is of the kind asked for. */
const nowOf = <K extends PlayerNow['kind']>(now: PlayerNow, ...kinds: K[]) =>
  (kinds as string[]).includes(now.kind) ? (now as Extract<PlayerNow, { kind: K }>) : null;

/** Where the player is this round: a table, a bye, a missed round, out, or not paired. */
function NowLine(props: { seen: Seen }) {
  const now = createMemo(() => playerNow(props.seen.props.manage.tournament, props.seen.props.player.id));
  return (
    <Switch fallback={<p class='muted'>{t('Not paired yet')}</p>}>
      <Match when={nowOf(now(), 'table')}>
        {seat => (
          <div class='tm-sheet-now'>
            <p>
              <strong>{t('Table {table}', { table: seat().table })}</strong> · {roundLabel(seat().round, seat().pod)}
            </p>
            <div class='tm-sheet-seat'>
              <Opponent seen={props.seen} id={seat().opponent} />
              <Show when={seat().mark} fallback={<span class='muted'>{t('Playing')}</span>}>
                <Squares marks={[seat().mark]} />
              </Show>
            </div>
          </div>
        )}
      </Match>
      <Match when={nowOf(now(), 'bye', 'missed')}>
        {seat => (
          <p>
            <strong>{seat().kind === 'bye' ? t('Bye') : t('Missed round')}</strong> ·{' '}
            {roundLabel(seat().round, seat().pod)}
          </p>
        )}
      </Match>
      <Match when={nowOf(now(), 'out')}>{out => <p>{outLine(out())}</p>}</Match>
    </Switch>
  );
}

function Now(props: { seen: Seen }) {
  const player = () => props.seen.props.player;
  return (
    <Section title={t('Now')}>
      <NowLine seen={props.seen} />
      {/* Before round 1, what staff check at the door, ticked here as on the roster. */}
      <Show when={showsCheckIn(props.seen.props.manage)}>
        <CheckInMarks
          state={props.seen.props.state}
          manage={props.seen.props.manage}
          id={player().id}
          name={playerName(player())}
        />
      </Show>
    </Section>
  );
}

const submittedAt = (at: number) =>
  new Date(at).toLocaleString(intlLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** The list's line: when it came in, on paper or pasted, and what the parser found wrong with it. */
function ListLine(props: { list: Decklist }) {
  return (
    <>
      <p class='muted tm-num'>
        {t('Sent {date}', { date: submittedAt(props.list.submittedAt) })}
        <Show when={props.list.mode === 'paper'}> · {t('In person')}</Show>
      </p>
      <Show when={props.list.problems.length}>
        <p class='tm-problem'>{props.list.problems.join(t('; '))}</p>
      </Show>
    </>
  );
}

/** Whether the player's list is in, and the deck it is named as. */
function ListSection(props: { seen: Seen }) {
  const manage = () => props.seen.props.manage;
  const id = () => props.seen.props.player.id;
  const [lists, { refetch }] = createResource(
    () => manage().code,
    code => fetchDecklists(code).then(result => result.decklists)
  );
  const playerOf = createMemo(() => decklistMatcher(manage().tournament, isSanctioned(manage())));
  const deck = (list: Decklist | undefined) => manage().decks[id()] ?? list?.archetype ?? t('Unclassified');
  return (
    <Section title={t('Decklist')}>
      <Loaded
        value={lists.latest}
        failed={Boolean(lists.error)}
        error={t('The decklists could not be loaded.')}
        onRetry={() => void refetch()}
      >
        {all => {
          const list = () => all().find(entry => playerOf()(entry) === id());
          return (
            <>
              <Show when={decksEnabled(manage().settings)}>
                <p>
                  <strong>{deck(list())}</strong>
                </p>
              </Show>
              <Show when={list()} fallback={<p class='muted'>{t('No list yet')}</p>}>
                {found => <ListLine list={found()} />}
              </Show>
            </>
          );
        }}
      </Loaded>
    </Section>
  );
}

/** One note or check: what it was, in which round, who gave it, and its notes under. */
function Entry(props: { what: JSX.Element; round: number; by: string | null; notes: string }) {
  return (
    <li>
      <span>
        {props.what} · {t('Round {round}', { round: props.round })} · {props.by ?? t('Deleted account')}
      </span>
      <Show when={props.notes}>
        <span class='muted'>{props.notes}</span>
      </Show>
    </li>
  );
}

function PenaltySection(props: { seen: Seen }) {
  const id = () => props.seen.props.player.id;
  const [record, { refetch }] = createResource(() => props.seen.props.manage.code, fetchPenaltyNotes);
  const notes = createMemo(() =>
    standingNotes(record.latest?.entries ?? [])
      .filter(note => note.playerId === id())
      .sort((a, b) => b.round - a.round || b.recordedAt - a.recordedAt)
  );
  return (
    <Section title={t('Penalties')}>
      <Loaded
        value={record.latest}
        failed={Boolean(record.error)}
        error={t('Penalty notes could not be loaded.')}
        onRetry={() => void refetch()}
      >
        {() => (
          <Show when={notes().length} fallback={<p class='muted'>{t('No penalty notes yet.')}</p>}>
            <ul class='tm-sheet-entries'>
              <For each={notes()}>
                {note => (
                  <Entry
                    what={
                      <strong class={DECIDING_PENALTIES.has(note.penalty) ? 'tm-penalty-deciding' : undefined}>
                        {t(PENALTY_LABELS[note.penalty])}
                      </strong>
                    }
                    round={note.round}
                    by={note.judge.name}
                    notes={note.notes}
                  />
                )}
              </For>
            </ul>
          </Show>
        )}
      </Loaded>
    </Section>
  );
}

function CheckSection(props: { seen: Seen }) {
  const id = () => props.seen.props.player.id;
  const [record, { refetch }] = createResource(() => props.seen.props.manage.code, fetchDeckChecks);
  const checks = createMemo(() =>
    standingChecks(record.latest?.entries ?? [])
      .filter(check => check.playerId === id())
      .sort((a, b) => b.round - a.round || b.recordedAt - a.recordedAt)
  );
  return (
    <Section title={t('Deck checks')}>
      <Loaded
        value={record.latest}
        failed={Boolean(record.error)}
        error={t('Deck checks could not be loaded.')}
        onRetry={() => void refetch()}
      >
        {() => (
          <Show when={checks().length} fallback={<p class='muted'>{t('No deck checks yet.')}</p>}>
            <ul class='tm-sheet-entries'>
              <For each={checks()}>
                {check => (
                  <Entry
                    what={
                      <strong class={`tm-check-${check.result}`}>
                        {check.result === 'pass' ? t('Pass') : t('Fail')}
                      </strong>
                    }
                    round={check.round}
                    by={check.checker.name}
                    notes={check.notes}
                  />
                )}
              </For>
            </ul>
          </Show>
        )}
      </Loaded>
    </Section>
  );
}

/** The line under the name: their Player ID and division at a sanctioned event, their record, and how they stand. */
function subLine(manage: Manage, player: Player, record: string | undefined): string {
  const sanctioned = isSanctioned(manage);
  const division = divisionFor(player.birthDate, eventSeason(manage.tournament));
  return [
    sanctioned ? (isGeneratedId(player.id) ? t('Provisional ID') : player.id) : '',
    sanctioned ? t(DIVISION_LABELS[division]) : '',
    record ?? '',
    player.droppedAfter === null ? '' : player.disqualified ? t('Disqualified') : t('Dropped'),
    player.late ? t('Late') : '',
    player.fixedTable ? t('Fixed table {table}', { table: player.fixedTable }) : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Each player's record in the player's pod, for their own line and their opponents'. */
function recordsIn(manage: Manage, pod: Pod | undefined): Map<string, string> {
  const { tournament } = manage;
  const rows = pod ? swissStandings(pod, tournament.players, { regularRounds: regularRounds(tournament, pod) }) : [];
  return new Map(rows.map(row => [row.playerId, recordLabel(row.record)]));
}

export function StaffSheet(props: SheetProps) {
  const id = () => props.player.id;
  const pod = createMemo(() => playerPod(props.manage.tournament, id()));
  // A pod is made before its first round: until the player has a round in it, there is no record or round to show.
  const played = createMemo(() => {
    const p = pod();
    return p && matchHistory(p, id()).length > 0 ? p : undefined;
  });
  const records = createMemo(() => recordsIn(props.manage, pod()));
  const names = createMemo(() => namesById(props.manage.tournament));
  const decks = () => shownDecks(props.manage);
  const seen: Seen = { props, names, records, decks };
  const lists = () => props.manage.settings.decklists !== 'off';
  // Only where the roster offers them: the site runs the event, and there is something left to do.
  const acts = createMemo(() => props.manage.mode === 'swiss' && offersActions(props.manage, props.player));
  return (
    <Sheet
      title={
        <>
          <DeckIcons label={decks()[id()]} size={22} />
          {playerName(props.player)}
        </>
      }
      sub={subLine(props.manage, props.player, played() ? records().get(id()) : undefined)}
      onClose={props.onClose}
      foot={
        acts() ? (
          <PlayerActions state={props.state} manage={props.manage} player={props.player} menuLabel={t('Actions')} />
        ) : undefined
      }
    >
      <Now seen={seen} />
      <Show when={played()}>
        {p => (
          <Section title={t('Rounds')}>
            <HistoryTable
              pod={p()}
              playerId={id()}
              names={names()}
              records={records()}
              decks={decks()}
              onPlayer={props.onPlayer}
            />
          </Section>
        )}
      </Show>
      <Show when={lists()}>
        <ListSection seen={seen} />
      </Show>
      <Show when={hasStarted(props.manage.tournament)}>
        <PenaltySection seen={seen} />
      </Show>
      {/* Deck checks are recorded once round 1 is paired, as the Decklists tab takes them. */}
      <Show when={lists() && decklistsLocked(props.manage)}>
        <CheckSection seen={seen} />
      </Show>
    </Sheet>
  );
}
