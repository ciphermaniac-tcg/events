/**
 * The console's player list: add players (at any point, late arrivals
 * included), drop and reinstate them, give a player a fixed table, and set
 * the archetype each is on. A TOM event's roster belongs to TOM, so there it
 * is read-only apart from decks.
 *
 * The add form is one row in its own box; the roster is a box with its
 * search in the bar, then a row per player: the name over their Player ID
 * and division, their rounds as squares, the deck picker, the fixed table
 * and the actions. With archetypes off for the event the deck column stays
 * in place, greyed, with the way to turn it on.
 */

import { useSearchParams } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { divisionFor, eventSeason } from '../../../shared/tournament/divisions';
import { canUndrop, hasPlayed, hasStarted, joinedLate, playerPod, podOf } from '../../../shared/tournament/rounds';
import {
  DIVISION_LABELS,
  isGeneratedId,
  type Player,
  playerName,
  type Tournament
} from '../../../shared/tournament/types';
import { decksEnabled, isSanctioned } from '../../../shared/tournament/view';
import { type Manage, releaseReporter } from '../../lib/tournament/api';
import { matchHistory } from '../../lib/tournament/present';
import { t, tc, tn } from '../../lib/i18n';
import type { ReportedDeck } from '../live/reportedDeck';
import { OptionsMenu } from './OptionsMenu';
import { ConfirmAction } from './ConfirmAction';
import { decksFor } from './deckOptions';
import { createDeckOptions } from './deckPresets';
import { DeckPicker } from './DeckPicker';
import { EditPlayerDialog } from './EditPlayer';
import { Field } from './Field';
import type { ManageState } from './manageState';
import { birthDateFor } from './ProfileFields';
import { StaffRequests } from './StaffRequests';
import { Squares } from './Squares';
import { ReturningPlayerField } from './ReturningPlayerField';
import { capCount, CheckInBox, CheckInCells, CheckInHeads, createSiteRegistrants, showsCheckIn } from './CheckIn';
import { inRoster, isRosterFilter, type RosterFilter } from './rosterFilter';
import { notCheckedIn } from '../../../shared/tournament/checkins';
import { Segmented } from '@ciphermaniac/design/components/Segmented';

/**
 * A new player: a name, and at a sanctioned event their Player ID and birth
 * year. Once added, the first name takes focus again for the next in line.
 */
function AddPlayer(props: { state: ManageState; code: string; sanctioned: boolean; late: boolean }) {
  let firstInput: HTMLInputElement | undefined;
  const [first, setFirst] = createSignal('');
  const [last, setLast] = createSignal('');
  const [popId, setPopId] = createSignal('');
  const [year, setYear] = createSignal('');
  // A sanctioned event's player is reported to Play! Pokémon under their Player ID and placed by birth year.
  const identified = () => !props.sanctioned || (popId() !== '' && year().length === 4);
  async function submit(event: Event) {
    event.preventDefault();
    const ok = await props.state.send({
      type: 'addPlayer',
      player: {
        firstName: first(),
        lastName: last(),
        ...(props.sanctioned && popId() ? { id: popId() } : {}),
        ...(props.sanctioned && year() ? { birthDate: birthDateFor(year()) } : {})
      }
    });
    if (ok) {
      setFirst('');
      setLast('');
      setPopId('');
      setYear('');
      firstInput?.focus();
    }
  }
  return (
    <form class='tm-box tm-add-player' aria-label={t('Add a player')} onSubmit={event => void submit(event)}>
      <div class='tm-box-bar tm-add-row'>
        <Field id='add-first' label={t('First name')}>
          <ReturningPlayerField
            code={props.code}
            ref={el => (firstInput = el)}
            value={first()}
            onInput={setFirst}
            onPick={player => {
              setFirst(player.firstName);
              setLast(player.lastName);
              setPopId(player.popId);
              setYear(player.birthYear === null ? '' : String(player.birthYear));
            }}
          />
        </Field>
        <Field id='add-last' label={t('Last name')}>
          <input id='add-last' class='tm-input' value={last()} onInput={e => setLast(e.currentTarget.value)} />
        </Field>
        <Show when={props.sanctioned}>
          <Field id='add-pop' label={t('Player ID')}>
            <input
              id='add-pop'
              class='tm-input'
              inputmode='numeric'
              value={popId()}
              onInput={e => setPopId(e.currentTarget.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field id='add-year' label={t('Birth year')}>
            <input
              id='add-year'
              class='tm-input'
              inputmode='numeric'
              maxLength={4}
              value={year()}
              onInput={e => setYear(e.currentTarget.value.replace(/\D/g, ''))}
            />
          </Field>
        </Show>
        <button
          type='submit'
          class='btn btn-primary'
          disabled={props.state.busy() || !first().trim() || !last().trim() || !identified()}
        >
          {props.late ? t('Add late player') : t('Add player')}
        </button>
      </div>
      {/* Why Add stays grey once a name is in: the rest a sanctioned event needs. */}
      <Show when={!identified() && (first().trim() || last().trim())}>
        <p class='tm-box-bar muted'>{t('Player ID and birth year are needed at a sanctioned event')}</p>
      </Show>
    </form>
  );
}

function DeckCell(props: RowProps) {
  return (
    <td class='tm-deck-cell'>
      <DeckPicker state={props.state} manage={props.manage} playerId={props.player.id} decks={props.decks} />
    </td>
  );
}

/** Archetypes off for the event: the column keeps its place, greyed, with nothing to pick. */
function DeckOffCell() {
  return (
    <td class='tm-deck-cell is-off'>
      <span class='tm-deck-off' aria-hidden='true'>
        {t('Deck')}
      </span>
    </td>
  );
}

/**
 * Static seating: a player who cannot move between tables keeps one. Saved
 * when the field loses focus or Enter is pressed; emptied, it frees the table.
 */
function FixedTableField(props: { state: ManageState; player: Player }) {
  function save(value: string) {
    const table = value.trim() ? Number(value) : null;
    if (table === (props.player.fixedTable ?? null)) {
      return;
    }
    const { id } = props.player;
    void props.state.send({ type: 'setFixedTable', id, table });
  }
  return (
    <label class='tm-menu-field' title={t('Static seating: this player sits at the same table every round')}>
      {t('Fixed table')}
      <input
        class='tm-input tm-table-input'
        inputmode='numeric'
        aria-label={t('Fixed table for {name}', { name: playerName(props.player) })}
        placeholder='—'
        value={props.player.fixedTable ?? ''}
        onChange={e => save(e.currentTarget.value.replace(/\D/g, ''))}
      />
    </label>
  );
}

/**
 * Lets another device report for a player, as when they change phones or
 * someone else claimed them first, where players report. At an unsanctioned
 * event the same release undoes the Claim a signed-in account made on the
 * player, reporting or not, and there it reads as unlinking them. Staff are
 * not shown which players an account holds.
 */
const reportsFor = (manage: Manage, player: Player) => manage.settings.playerReporting && player.droppedAfter === null;

/** Whether ReleaseAction has anything to offer for the player. */
const mayRelease = (manage: Manage, player: Player) => reportsFor(manage, player) || !isSanctioned(manage);

function ReleaseAction(props: { state: ManageState; manage: Manage; player: Player }) {
  const reporting = () => reportsFor(props.manage, props.player);
  const name = () => playerName(props.player);
  return (
    <Show when={mayRelease(props.manage, props.player)}>
      <ConfirmAction
        label={reporting() ? t('Reset reporting') : t('Unlink account')}
        class='tm-menu-item'
        question={
          reporting()
            ? t('Let another device report for {name}?', { name: name() })
            : t('Unlink {name} from their account?', { name: name() })
        }
        confirmLabel={reporting() ? t('Reset') : t('Unlink')}
        onConfirm={() => void props.state.act(releaseReporter(props.manage.code, props.player.id))}
      />
    </Show>
  );
}

/**
 * Drop, disqualify, reinstate, remove (only before the player's first match:
 * after it they are dropped). A drop or disqualification can be taken back
 * only until the next round is paired (see undropPlayer in
 * shared/tournament/commands.ts). Staff can also free the player for another
 * device or account (see ReleaseAction), which alone stays once the event has
 * ended: the roster stands with its results until the event is reopened.
 */
function PlayerActions(props: { state: ManageState; manage: Manage; player: Player }) {
  const send = (type: 'dropPlayer' | 'disqualifyPlayer' | 'undropPlayer' | 'removePlayer') =>
    void props.state.send({ type, id: props.player.id });
  const pod = () => podOf(props.manage.tournament, props.player.id);
  const dropped = () => props.player.droppedAfter;
  const ended = () => props.manage.settings.finished;
  const [editing, setEditing] = createSignal(false);
  return (
    <td class='tm-extra-col'>
      <Show when={editing()}>
        <EditPlayerDialog
          state={props.state}
          player={props.player}
          sanctioned={isSanctioned(props.manage)}
          open
          onClose={() => setEditing(false)}
        />
      </Show>
      <span class='tm-row-actions'>
        <Show when={!ended() && dropped() !== null && canUndrop(props.manage.tournament, props.player)}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => send('undropPlayer')}>
            {t('Reinstate')}
          </button>
        </Show>
        {/* Once paired, a player is dropped rather than removed, so their opponents keep the match. */}
        <Show when={!ended() && !hasPlayed(pod(), props.player.id)}>
          <ConfirmAction
            label={t('Remove')}
            question={t('Remove {name}?', { name: playerName(props.player) })}
            danger
            onConfirm={() => send('removePlayer')}
          />
        </Show>
        <Show when={!ended() || mayRelease(props.manage, props.player)}>
          <OptionsMenu name={playerName(props.player)}>
            <Show when={!ended()}>
              <FixedTableField state={props.state} player={props.player} />
            </Show>
            <Show when={!ended()}>
              <button type='button' class='tm-menu-item' data-closes-menu onClick={() => setEditing(true)}>
                {t('Edit')}
              </button>
            </Show>
            <Show when={!ended() && dropped() === null}>
              <ConfirmAction
                label={t('Drop')}
                question={t('Drop {name}? You can reinstate them until the next round is paired.', {
                  name: playerName(props.player)
                })}
                class='tm-menu-item'
                danger
                onConfirm={() => send('dropPlayer')}
              />
              <ConfirmAction
                label={t('Disqualify')}
                question={t('Disqualify {name}? It goes in the event file. Write the penalty note under Penalties.', {
                  name: playerName(props.player)
                })}
                class='tm-menu-item'
                danger
                onConfirm={() => send('disqualifyPlayer')}
              />
            </Show>
            <ReleaseAction state={props.state} manage={props.manage} player={props.player} />
          </OptionsMenu>
        </Show>
      </span>
    </td>
  );
}

/** A player's results so far, one mark per round they could play: their pod's, and their division's top cut's. */
function marksOf(tournament: Tournament, player: Player): { marks: string[]; rounds: number } {
  const pod = playerPod(tournament, player.id);
  if (!pod) {
    return { marks: [], rounds: 0 };
  }
  const history = matchHistory(pod, player.id);
  const byRound = new Map(history.map(row => [row.round, row.mark]));
  return { marks: pod.rounds.map(round => byRound.get(round.number) ?? ''), rounds: pod.rounds.length };
}

interface RowProps {
  state: ManageState;
  manage: Manage;
  player: Player;
  season: number;
  showRounds: boolean;
  decks: readonly ReportedDeck[];
}

const droppedLine = (disqualified: boolean | undefined, round: number) =>
  disqualified ? t('disqualified after round {round}', { round }) : t('dropped after round {round}', { round });

function PlayerRow(props: RowProps) {
  const swiss = () => props.manage.mode === 'swiss';
  const sanctioned = () => isSanctioned(props.manage);
  const sub = () =>
    [
      sanctioned() ? (isGeneratedId(props.player.id) ? t('Provisional ID') : props.player.id) : '',
      sanctioned() ? t(DIVISION_LABELS[divisionFor(props.player.birthDate, props.season)]) : '',
      props.player.droppedAfter === null ? '' : droppedLine(props.player.disqualified, props.player.droppedAfter)
    ]
      .filter(Boolean)
      .join(' · ');
  const history = () => marksOf(props.manage.tournament, props.player);
  return (
    <tr classList={{ 'is-dropped': props.player.droppedAfter !== null }}>
      <td class='tm-who'>
        <span class='tm-who-name'>
          <span class='tm-name'>{playerName(props.player)}</span>
          <Show
            when={props.player.late || joinedLate(playerPod(props.manage.tournament, props.player.id), props.player.id)}
          >
            <span class='tm-flag'>{t('Late')}</span>
          </Show>
          <Show when={props.player.fixedTable}>
            {table => <span class='tm-flag'>{t('Table {table}', { table: table() })}</span>}
          </Show>
          <Show when={props.player.droppedAfter !== null}>
            <span class='tm-flag'>{props.player.disqualified ? t('Disqualified') : t('Dropped')}</span>
          </Show>
        </span>
        <Show when={sub()}>
          <span class='tm-who-sub tm-num'>{sub()}</span>
        </Show>
      </td>
      <Show when={props.showRounds}>
        <td class='tm-rounds-cell'>
          <Squares marks={history().marks} rounds={history().rounds} />
        </td>
      </Show>
      <Show when={decksEnabled(props.manage.settings)} fallback={<DeckOffCell />}>
        <DeckCell {...props} />
      </Show>
      <Show when={showsCheckIn(props.manage)}>
        <CheckInCells state={props.state} manage={props.manage} id={props.player.id} name={playerName(props.player)} />
      </Show>
      <Show when={swiss()} fallback={<td class='tm-extra-col' />}>
        <PlayerActions state={props.state} manage={props.manage} player={props.player} />
      </Show>
    </tr>
  );
}

/** The roster's filter, while check-in is open: everyone, or only who is not checked in. */
function RosterShow(props: { selected: RosterFilter; open: number; onSelect: (value: RosterFilter) => void }) {
  return (
    <Segmented
      options={[
        { value: 'all', label: tc('players', 'All') },
        {
          value: 'unchecked',
          label: (
            <>
              {t('Not checked in')}
              <Show when={props.open > 0}>
                <span class='tm-count'>{props.open}</span>
              </Show>
            </>
          )
        }
      ]}
      selected={props.selected}
      onSelect={value => props.onSelect(value)}
      ariaLabel={t('Show')}
    />
  );
}

export function PlayersPanel(props: { state: ManageState; manage: Manage }) {
  // In the URL beside the tab, so a reload keeps the list it showed.
  const [params, setParams] = useSearchParams<{ tab?: string; show?: string }>();
  const [query, setQuery] = createSignal('');
  const filter = (): RosterFilter => (isRosterFilter(params.show) && showsCheckIn(props.manage) ? params.show : 'all');
  const season = () => eventSeason(props.manage.tournament);
  const swiss = () => props.manage.mode === 'swiss';
  const sanctioned = () => isSanctioned(props.manage);
  const started = () => hasStarted(props.manage.tournament);
  const archetypes = () => decksEnabled(props.manage.settings);
  const decks = createDeckOptions(() => props.manage.settings.format, decksFor, {
    inEvent: () => Object.values(props.manage.decks),
    startDate: () => props.manage.tournament.info.startDate
  });
  const players = createMemo(() =>
    props.manage.tournament.players
      .filter(p => inRoster(props.manage, p, filter(), query()))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
  );
  // At a TOM event before round 1, whoever registered on the site and is not in TOM's file yet.
  const siteRegistrants = createSiteRegistrants(() => props.manage);
  const registrants = () => siteRegistrants().filter(p => inRoster(props.manage, p, filter(), query()));
  const unchecked = () =>
    notCheckedIn(props.manage, [...props.manage.tournament.players, ...siteRegistrants()], props.manage.checkins ?? {})
      .length;
  const count = () => {
    const all = props.manage.tournament.players.length;
    const capped = capCount(props.manage, props.manage.tournament.players.filter(p => p.droppedAfter === null).length);
    if (players().length === all && capped) {
      return capped;
    }
    return players().length === all
      ? tn(all, '{n} players', '{n} players')
      : tn(all, '{shown} of {n} players', '{shown} of {n} players', { shown: players().length });
  };
  return (
    <div class='tm-panel'>
      <Show when={swiss() && !props.manage.settings.finished}>
        <AddPlayer state={props.state} code={props.manage.code} sanctioned={sanctioned()} late={started()} />
      </Show>
      <StaffRequests state={props.state} manage={props.manage} />
      <CheckInBox state={props.state} manage={props.manage} extra={siteRegistrants()} />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <input
            class='search'
            type='search'
            placeholder={t('Search players')}
            aria-label={t('Search players')}
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
          />
          <span class='muted tm-num'>{count()}</span>
          <Show when={showsCheckIn(props.manage)}>
            <span class='tm-grow' />
            <RosterShow
              selected={filter()}
              open={unchecked()}
              onSelect={value => setParams({ show: value === 'all' ? undefined : value }, { replace: true })}
            />
          </Show>
        </div>
        <div class='table-wrap'>
          <table class='data tm-roster'>
            <thead>
              <tr>
                <th>{t('Player')}</th>
                <Show when={started()}>
                  <th>{t('Rounds')}</th>
                </Show>
                <th>
                  {t('Deck')}
                  <Show when={!archetypes()}>
                    <span class='tm-th-note'>
                      {' '}
                      · {t('off')}{' '}
                      <button type='button' class='tm-th-link' onClick={() => setParams({ tab: 'event' })}>
                        {t('Turn on in Settings')}
                      </button>
                    </span>
                  </Show>
                </th>
                <Show when={showsCheckIn(props.manage)}>
                  <CheckInHeads
                    manage={props.manage}
                    players={[...props.manage.tournament.players, ...siteRegistrants()]}
                  />
                </Show>
                <th>
                  <span class='sr-only'>{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={players()}>
                {player => (
                  <PlayerRow
                    state={props.state}
                    manage={props.manage}
                    player={player}
                    season={season()}
                    showRounds={started()}
                    decks={decks()}
                  />
                )}
              </For>
              <For each={registrants()}>
                {player => (
                  <tr>
                    <td class='tm-who'>
                      <span class='tm-who-name'>
                        <span class='tm-name'>{playerName(player)}</span>
                      </span>
                      <span class='tm-who-sub tm-num'>{player.id}</span>
                    </td>
                    <td />
                    <Show when={showsCheckIn(props.manage)}>
                      <CheckInCells
                        state={props.state}
                        manage={props.manage}
                        id={player.id}
                        name={playerName(player)}
                      />
                    </Show>
                    <td class='tm-extra-col' />
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={players().length === 0}>
          <p class='muted tm-empty'>
            {props.manage.tournament.players.length ? t('No players match.') : t('No players yet.')}
          </p>
        </Show>
      </section>
    </div>
  );
}
