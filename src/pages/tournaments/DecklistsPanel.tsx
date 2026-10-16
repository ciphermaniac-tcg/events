/**
 * Decklists players submitted ahead of the event, in one box: a bar saying
 * whether submission is open (with the counts, and the control to open or
 * close it), a search, then a row per list. Lists with problems lead, then
 * lists whose submitter is not on the player list, then the rest in the order
 * they came in. Staff read each list laid out by section with what the parser
 * found wrong, add a submitter the site could not add, and take a player's
 * word for their deck.
 *
 * Players need no account, and submitting a list adds a submitter who is not
 * yet on a Swiss event's list; those players carry an "Added from list" flag.
 */

import { A } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch
} from 'solid-js';
import { birthYear } from '../../../shared/tournament/divisions';
import { latestRoundOf } from '../../../shared/tournament/staffRecords';
import { decklistMatcher } from '../../../shared/tournament/identify';
import { decklistsLocked, decklistsOpen, decksEnabled, isSanctioned } from '../../../shared/tournament/view';
import {
  type Decklist,
  fetchDecklists,
  type Manage,
  saveSettings,
  setDeck,
  unlockDecklist
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { intlLocale, t, tn } from '../../lib/i18n';
import { shared } from '../../lib/tournament/share';
import { ConfirmAction } from './ConfirmAction';
import { DecklistColumns } from './DecklistColumns';
import { createDeckChecks, type DeckChecks, DeckCheckSide, LastCheck } from './DeckChecks';
import { session } from './session';
import { DeckIcons } from './DeckIcons';
import type { ManageState } from './manageState';

const submittedAt = (at: number) =>
  new Date(at).toLocaleString(intlLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** Why a submitter is not on the player list: the site only adds them to a Swiss event still open. */
function notEnteredReason(manage: Manage): string {
  if (manage.mode === 'tom') {
    return t('Roster is TOM’s');
  }
  return manage.settings.finished ? t('Event closed') : t('Not on the player list');
}

/** Finds the player a list belongs to (see decklistMatcher). */
type PlayerOf = (list: Decklist) => string | undefined;

interface RowProps {
  state: ManageState;
  manage: Manage;
  list: Decklist;
  playerOf: PlayerOf;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  /** The event's deck checks, once round 1 is paired and there can be any; null before. */
  checks: DeckChecks | null;
}

function DecklistRow(props: RowProps) {
  const sanctioned = () => isSanctioned(props.manage);
  const playerId = () => props.playerOf(props.list);
  const archetypes = () => decksEnabled(props.manage.settings);
  const sub = () =>
    [
      archetypes() ? (props.list.archetype ?? t('No deck named')) : '',
      sanctioned() ? props.list.popId : '',
      sanctioned() ? (birthYear(props.list.birthDate) ?? '') : ''
    ]
      .filter(Boolean)
      .join(' · ');
  /** The player's word for their deck becomes the one the event shows; staff decide it is theirs. */
  function useDeck() {
    const { code } = props.manage;
    const id = playerId();
    const { archetype } = props.list;
    if (id) {
      void props.state.run(() => setDeck(code, id, archetype));
    }
  }
  async function add() {
    const ok = await props.state.send({
      type: 'addPlayer',
      player: {
        firstName: props.list.firstName,
        lastName: props.list.lastName,
        ...(sanctioned() ? { id: props.list.popId, birthDate: props.list.birthDate } : {})
      }
    });
    if (ok) {
      props.onChanged();
    }
  }
  /** Lets the player send the list again from another device; the next list sent under these details takes it over. */
  async function unlock() {
    if (await props.state.act(unlockDecklist(props.manage.code, props.list))) {
      props.onChanged();
    }
  }
  const canUseDeck = () =>
    archetypes() && playerId() && props.list.archetype && props.manage.decks[playerId() ?? ''] !== props.list.archetype;
  return (
    <>
      <tr>
        <td class='tm-list-sprite'>
          <Show when={archetypes()}>
            <DeckIcons label={props.list.archetype ?? undefined} />
          </Show>
        </td>
        <td class='tm-who'>
          <span class='tm-who-name'>
            <span class='tm-name'>
              {props.list.firstName} {props.list.lastName}
            </span>
            <Show when={props.list.fromList}>
              <span class='tm-flag'>{t('Added from list')}</span>
            </Show>
            <Show when={!playerId()}>
              <span class='tm-flag'>{t('Not entered')}</span>
            </Show>
          </span>
          <span class='tm-who-sub tm-num'>
            {sub()}
            <Show when={!playerId()}>
              {sub() ? ' · ' : ''}
              {notEnteredReason(props.manage)}
            </Show>
          </span>
        </td>
        <td class='muted-cell tm-num tm-nowrap tm-list-when'>{submittedAt(props.list.submittedAt)}</td>
        <td class='tm-list-check'>
          <Show when={props.list.problems.length} fallback={<span class='muted-cell'>OK</span>}>
            <span class='tm-problem'>{props.list.problems.join(t('; '))}</span>
          </Show>
        </td>
        <Show when={props.checks}>
          {checks => (
            <td class='tm-list-deck-check'>
              <LastCheck checks={checks()} playerId={playerId()} />
            </td>
          )}
        </Show>
        <td class='tm-extra-col'>
          <span class='tm-row-actions'>
            <button
              type='button'
              class='btn btn-ghost tm-small'
              aria-expanded={props.open}
              onClick={() => props.onToggle()}
            >
              {props.open ? t('Hide') : t('View')}
            </button>
            {/* An ended event's roster stands until it is reopened. */}
            <Show when={props.manage.mode === 'swiss' && !props.manage.settings.finished && !playerId()}>
              <button type='button' class='btn btn-ghost tm-small' onClick={() => void add()}>
                {t('Add to event')}
              </button>
            </Show>
            <Show when={canUseDeck()}>
              <button type='button' class='btn btn-ghost tm-small' onClick={useDeck}>
                {t('Use their deck')}
              </button>
            </Show>
            <Show when={props.list.locked && !decklistsLocked(props.manage)}>
              <ConfirmAction
                label={t('Unlock')}
                question={t('Let another device send this list?')}
                confirmLabel={t('Unlock')}
                onConfirm={() => void unlock()}
              />
            </Show>
          </span>
        </td>
      </tr>
      <Show when={props.open}>
        <tr class='tm-expansion'>
          <td colSpan={props.checks ? 6 : 5}>
            <Show when={props.checks && playerId()} keyed fallback={<DecklistColumns deck={props.list.deck} />}>
              {id => (
                <div class='tm-check-split'>
                  <DecklistColumns deck={props.list.deck} />
                  <DeckCheckSide
                    checks={props.checks as DeckChecks}
                    playerId={id}
                    latestRound={latestRoundOf(props.manage.tournament, id)}
                    me={latestValue(session)?.user?.id ?? null}
                  />
                </div>
              )}
            </Show>
          </td>
        </tr>
      </Show>
    </>
  );
}

/** Whether a list is its submitter's, by name, Player ID or deck, for the search. */
function listMatches(list: Decklist, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    `${list.firstName} ${list.lastName}`.toLowerCase().includes(q) ||
    list.popId.includes(q) ||
    (list.archetype ?? '').toLowerCase().includes(q)
  );
}

/** Problems first, then submitters not on the list, then the rest in the order they came in. */
function ordered(lists: readonly Decklist[], playerOf: PlayerOf): Decklist[] {
  const rank = (list: Decklist) => {
    if (list.problems.length > 0) {
      return 0;
    }
    return playerOf(list) ? 2 : 1;
  };
  // Ranked once each, not once per comparison.
  const ranks = new Map(lists.map(list => [list, rank(list)]));
  return [...lists].sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0) || a.submittedAt - b.submittedAt);
}

/** How often the tab looks for new lists while it is open. */
const LISTS_REFRESH_MS = 30_000;

/** Whether players can send lists: open, closed by staff, or locked since round 1 was paired (see decklistsLocked). */
function submissionWord(accepting: boolean, locked: boolean): string {
  if (locked) {
    return t('Locked after round 1');
  }
  return accepting ? t('Submission open') : t('Submission closed');
}

/** What stands in for the table with no lists to show: loading, a failed load, or none sent yet. */
function NoLists(props: { loading: boolean; failed: boolean; onRetry: () => void }) {
  return (
    <Switch fallback={<p class='muted tm-empty'>{t('No decklists yet.')}</p>}>
      <Match when={props.failed}>
        <p class='muted tm-empty'>
          {t('The decklists could not be loaded.')}{' '}
          <button type='button' class='btn btn-secondary tm-small' onClick={() => props.onRetry()}>
            {t('Retry')}
          </button>
        </p>
      </Match>
      <Match when={props.loading}>
        <p class='muted tm-empty'>{t('Loading decklists…')}</p>
      </Match>
    </Switch>
  );
}

export function DecklistsPanel(props: { state: ManageState; manage: Manage }) {
  const [lists, { refetch, mutate }] = createResource(
    () => props.manage.code,
    code => fetchDecklists(code).then(result => result.decklists)
  );
  const accepting = () => decklistsOpen(props.manage);
  const locked = () => decklistsLocked(props.manage);
  // Deck checks are read once round 1 is paired, before which there can be none.
  const checks = createMemo(() => (locked() ? createDeckChecks(() => props.manage.code) : null));
  /** Looks for new lists, keeping the rows of the lists that did not change. A failed look keeps the lists shown. */
  const look = () =>
    void fetchDecklists(props.manage.code)
      .then(result => mutate(shared(latestValue(lists), result.decklists)))
      .catch(() => undefined);
  // A list from a player already entered does not change the event, so the console's own refresh misses it.
  // Lists only come in while submission is open, so that is when the tab looks, and once more as it closes.
  onMount(() => {
    const timer = setInterval(() => {
      if (!document.hidden && accepting() && lists.state === 'ready') {
        look();
      }
    }, LISTS_REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });
  createEffect(on(accepting, look, { defer: true }));
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string | null>(null);
  const all = () => latestValue(lists) ?? [];
  // The roster is read once for every list, and again only when the players change.
  const playerOf = createMemo(() => decklistMatcher(props.manage.tournament, isSanctioned(props.manage)));
  const shown = createMemo(() =>
    ordered(
      all().filter(list => listMatches(list, query())),
      playerOf()
    )
  );
  const counts = () => {
    const withProblems = all().filter(list => list.problems.length > 0).length;
    const notIn = all().filter(list => !list.registered).length;
    const fromList = all().filter(list => list.fromList).length;
    const last = all().reduce((max, list) => Math.max(max, list.submittedAt), 0);
    return [
      tn(all().length, '{n} list', '{n} lists'),
      ...(withProblems ? [tn(withProblems, '{n} with problems', '{n} with problems')] : []),
      ...(notIn ? [tn(notIn, '{n} not entered', '{n} not entered')] : []),
      ...(fromList ? [tn(fromList, '{n} added from lists', '{n} added from lists')] : []),
      ...(last ? [t('last {time}', { time: submittedAt(last) })] : [])
    ].join(' · ');
  };
  const key = (list: Decklist) => `${list.popId}|${list.firstName}|${list.lastName}`;
  function toggle() {
    const { code } = props.manage;
    const decklists = accepting() ? 'closed' : 'open';
    void props.state.run(() => saveSettings(code, { decklists }));
  }
  return (
    <div class='tm-panel'>
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>{submissionWord(accepting(), locked())}</strong>
          <span class='muted tm-num'>{counts()}</span>
          <A class='tm-bar-link' href={`/t/${props.manage.code}?tab=decklist`}>
            {t('Submit decklist page')}
          </A>
          <span class='tm-grow' />
          <Show when={!locked()}>
            <button type='button' class='btn btn-secondary tm-small' disabled={props.state.busy()} onClick={toggle}>
              {accepting() ? t('Close submission') : t('Open submission')}
            </button>
          </Show>
        </div>
        <div class='tm-box-bar'>
          <input
            class='search'
            type='search'
            placeholder={t('Search lists')}
            aria-label={t('Search lists')}
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
          />
        </div>
        <Show
          when={all().length}
          fallback={<NoLists loading={lists.loading} failed={Boolean(lists.error)} onRetry={() => void refetch()} />}
        >
          <div class='table-wrap'>
            <table class='data tm-lists'>
              <thead>
                <tr>
                  <th class='tm-list-sprite'>
                    <span class='sr-only'>{t('Deck')}</span>
                  </th>
                  <th>{t('Player')}</th>
                  <th>{t('Submitted')}</th>
                  <th>{t('Check')}</th>
                  <Show when={checks()}>
                    <th>{t('Last deck check')}</th>
                  </Show>
                  <th>
                    <span class='sr-only'>{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={shown()}>
                  {list => (
                    <DecklistRow
                      state={props.state}
                      manage={props.manage}
                      list={list}
                      playerOf={playerOf()}
                      open={open() === key(list)}
                      onToggle={() => setOpen(open() === key(list) ? null : key(list))}
                      onChanged={() => void refetch()}
                      checks={checks()}
                    />
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </section>
    </div>
  );
}
