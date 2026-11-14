/**
 * /t/:code: the page players follow. The head says where the event stands;
 * a player the page knows (by their profile's Player ID, a device that
 * remembers them, or "This is me" in a player sheet) gets their own match
 * first. Pairings and standings update on their own, each in one box with the
 * division switch and search in its bar. Decks show only as the event allows
 * (the server leaves hidden ones out), and decklists are submitted from here
 * while the organizer has submission open. `?screen=1` makes it the big
 * screen, and `?stream=table&table=N` one table's overlay for a stream.
 */

import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { lazyOnAir, lazyPanel } from './lazyPanel';
import { eventSeason } from '../../../shared/tournament/divisions';
import { hasStarted, latestRound, livePods, playerPod, podOf, regularRounds } from '../../../shared/tournament/rounds';
import { recordLabel, swissStandings } from '../../../shared/tournament/standings';
import { type Pod, POD_CATEGORIES, type PodCategory, type Round } from '../../../shared/tournament/types';
import { lateListsOpen } from '../../../shared/tournament/lateLists';
import {
  decklistsOpen,
  isSanctioned,
  listsPublic,
  type PublishedView,
  type TournamentSettings,
  type TournamentView
} from '../../../shared/tournament/view';
import { asksWhoYouAre, eventTimes } from '../../../shared/tournament/eventTime';
import { isWallClock } from '../../../shared/tournament/timeZone';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { TabPanel, Tabs } from '@ciphermaniac/design/components/Tabs';
import { fetchListReaders, leaveEvent, type Session } from '../../lib/tournament/api';
import { ordinal } from '../../lib/format';
import { latestValue } from '../../lib/resource';
import { holdsDecklist } from '../../lib/tournament/sessionMemory';
import { readFollowing, toggleFollowing } from '../../lib/tournament/spectate';
import { POLL_MS, SCREEN_POLL_MS } from '../../lib/tournament/viewPoll';
import { dayLabel, eventDay, playerResult } from '../../lib/tournament/history';
import {
  divisionHeading,
  eventStatus,
  firstRoundTime,
  foundElsewhere,
  namesById,
  podLabel,
  podProgress,
  roundCapOf
} from '../../lib/tournament/present';
import type { Tab as DashboardTab } from './Dashboard';
import { TournamentHero } from './Hero';
import { createNow } from './now';
import { createView, missing } from './publicView';
import { createMe } from './viewerIdentity';
import { createClockNow, StaleSince } from './Clock';
import { leadDivision } from './clockOrder';
import { formatFee } from '../../lib/events/format';
import { EventLogistics } from './EventLogistics';
import { FinalResults } from './FinalResults';
import { PlayerSheet } from './PlayerSheet';
import { PublicPairings } from './PublicPairings';
import type { Identified } from './Identify';
import { StandingsTable } from './StandingsTable';
import { YourMatch } from './YourMatch';
import '../../styles/pages/tournament-public.css';
import { pageTitle } from '../../lib/title';
import { RoundStepper } from './RoundStepper';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { staleSince } from '../../lib/tournament/liveData';
import { LiveDataStatus } from './LiveDataStatus';
import { MAIN_SITE } from '../../lib/constants';
import { msg, t, timeOfDay, tn, tx } from '../../lib/i18n';

const BigScreen = lazyOnAir(() => import('./BigScreen').then(m => ({ default: m.BigScreen })));
const StreamOverlay = lazyOnAir(() => import('./StreamOverlay').then(m => ({ default: m.StreamOverlay })));
const DeckStats = lazyPanel(() => import('./DeckStats').then(m => ({ default: m.DeckStats })));
const DecklistForm = lazyPanel(() => import('./DecklistForm').then(m => ({ default: m.DecklistForm })));

type Tab = 'pairings' | 'standings' | 'decks' | 'decklist';

/** The tabs a phone keeps the player's table pinned on, once their strip scrolls away. */
const PINS_MATCH: ReadonlySet<string> = new Set(['pairings', 'standings']);

/** Whether a registration can still correct its birth year: before round 1, at a sanctioned event paired here. */
const yearsCorrectable = (view: TournamentView) => isSanctioned(view) && view.mode === 'swiss' && decklistsOpen(view);

/** Every round paired so far, across the event's pods: one more each time any of them pairs. */
const pairedRounds = (view: TournamentView) => view.tournament.pods.reduce((n, pod) => n + pod.rounds.length, 0);

/** Whether the form takes lists: before round 1, or from a late entrant in their round (see lateListsOpen). */
const takingLists = (view: TournamentView) => decklistsOpen(view) || lateListsOpen(view);

/**
 * The registration tab: the form while players can register, and once they
 * cannot, the receipt for a viewer who may have a list (a device that sent
 * one, or an account that is a player here).
 */
function decklistTab(view: TournamentView, mayHaveList: boolean): { value: Tab; label: string }[] {
  if (takingLists(view)) {
    // After round 1, only a late entrant can still send a list: a newcomer is not offered to register.
    const fresh = decklistsOpen(view) ? t('Register') : t('Late decklist');
    return [{ value: 'decklist', label: mayHaveList ? t('Registration') : fresh }];
  }
  return view.settings.decklists !== 'off' && mayHaveList ? [{ value: 'decklist', label: t('Registration') }] : [];
}

/** Before round 1 an event taking registrations shows only that: pairings and standings have nothing in them yet. */
function tabsFor(view: TournamentView, mayHaveList: boolean): { value: Tab; label: string }[] {
  const register = decklistTab(view, mayHaveList);
  const results =
    hasStarted(view.tournament) || register.length === 0
      ? [
          { value: 'pairings' as const, label: t('Pairings') },
          { value: 'standings' as const, label: t('Standings') }
        ]
      : [];
  return [
    ...results,
    ...(Object.keys(view.decks).length ? [{ value: 'decks' as const, label: t('Decks') }] : []),
    ...register
  ];
}

/** Before round 1, the decklist form if it is open; once the event is closed, where everyone finished. */
function defaultTab(view: TournamentView): Tab {
  if (!hasStarted(view.tournament)) {
    return 'decklist';
  }
  return view.settings.finished ? 'standings' : 'pairings';
}

function pickTab(tabs: readonly { value: Tab }[], wanted: string | undefined, view: TournamentView): Tab {
  const choice = (wanted as Tab | undefined) ?? defaultTab(view);
  return tabs.some(t => t.value === choice) ? choice : (tabs[0]?.value ?? 'pairings');
}

const NO_LISTS: ReadonlySet<string> = new Set();

/** One line under every panel while decks wait for the event to end. */
const deckNote = (view: TournamentView) =>
  view.settings.deckVisibility === 'after' && !view.settings.finished
    ? t('Decks shown once the event ends')
    : undefined;

/** The console's round picker; the line under the event's name says where the round stands. */
function RoundSelect(props: { pod: Pod | undefined; round: Round | undefined; onSelect: (n: number) => void }) {
  return (
    <Show when={props.pod?.rounds.length ? props.pod : undefined}>
      {pod => (
        <RoundStepper
          pod={pod()}
          selected={props.round?.number ?? pod().rounds.at(-1)?.number ?? 1}
          onSelect={props.onSelect}
        />
      )}
    </Show>
  );
}

/** The sheet for the player last opened, in the pod they play in. */
function OpenPlayer(props: {
  view: TournamentView;
  fallback: Pod | undefined;
  id: string;
  me: string | null;
  /** The viewer put away "Which player are you?", so the sheet does not press them to be this player. */
  watching: boolean;
  names: Map<string, string>;
  following: ReadonlySet<string>;
  onFollow: (id: string) => void;
  onIdentified: (found: Identified) => void;
  onForget: () => void;
  onOpen: (id: string | null) => void;
}) {
  // Every round they played, their division's top cut included, as one pod (see playerPod).
  const pod = createMemo(() => playerPod(props.view.tournament, props.id) ?? props.fallback);
  const division = () => divisionHeading(props.view.divisions[props.id] ?? null);
  // Memos: the sheet reads these once per row of the player's history, and ranking a pod is a pass over its every match.
  const standings = createMemo(() => {
    const p = pod();
    const { tournament } = props.view;
    return p ? swissStandings(p, tournament.players, { regularRounds: regularRounds(tournament, p) }) : [];
  });
  const records = createMemo(() => new Map(standings().map(row => [row.playerId, recordLabel(row.record)])));
  // The place History gives the same player (see playerResult).
  const place = createMemo(() => {
    const at = playerResult(props.view, props.id)?.place;
    return at
      ? t('{place} in {division}', { place: ordinal(at), division: division() })
      : `${division()} · ${t('Registered')}`;
  });
  return (
    <Show when={pod()}>
      {p => (
        <PlayerSheet
          view={props.view}
          playerId={props.id}
          pod={p()}
          standing={standings().find(row => row.playerId === props.id)}
          place={place()}
          names={props.names}
          records={records()}
          decks={props.view.decks}
          me={props.me}
          watching={props.watching}
          following={props.following.has(props.id)}
          onFollow={() => props.onFollow(props.id)}
          onIdentified={props.onIdentified}
          onForget={props.onForget}
          onClose={() => props.onOpen(null)}
          onPlayer={props.onOpen}
        />
      )}
    </Show>
  );
}

/** Before round 1: who is in, by last name, so a player can check they are. */
function RegisteredList(props: {
  view: TournamentView;
  me: string | null;
  query: string;
  onPlayer: (id: string) => void;
}) {
  const players = () =>
    props.view.tournament.players
      .filter(player => player.droppedAfter === null)
      .filter(player =>
        `${player.firstName} ${player.lastName}`.toLowerCase().includes(props.query.trim().toLowerCase())
      )
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return (
    <>
      <p class='tm-box-bar muted'>{t('Pairings will show here once round 1 is paired.')}</p>
      <ul class='tm-registered'>
        <For each={players()}>
          {player => (
            <li>
              <button type='button' class='tm-seat-link' onClick={() => props.onPlayer(player.id)}>
                <span class='tm-name'>
                  {player.firstName} <strong>{player.lastName}</strong>
                </span>
                <Show when={player.id === props.me}>
                  <span class='tm-flag is-you'>{t('You')}</span>
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </>
  );
}

function EventBody(props: {
  view: TournamentView;
  session: Session | undefined;
  onView: (view: PublishedView) => void;
  /** Asks the API who the viewer is, when the page has reason to think it changed. */
  onWhoAmI: () => void;
  onUnlinked: () => void;
  /** Under the hero: how fresh the page's copy of the event is. */
  notice: JSX.Element;
}) {
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const [podChoice, setPodChoice] = createSignal<PodCategory | null>(null);
  const [roundChoice, setRoundChoice] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string | null>(null);
  // eslint-disable-next-line solid/reactivity -- the page is one event's for as long as it is open
  const [following, setFollowing] = createSignal(readFollowing(props.view.code));
  const follow = (id: string) => setFollowing(toggleFollowing(props.view.code, id));
  const { me, claim, reportToken, reports, identified, forget, watching, watch, recheck } = createMe(() => props.view, {
    onView: view => props.onView(view),
    onLinked: () => props.onWhoAmI()
  });
  /** The account's Claim undone: gone from its History, and from this device. */
  async function unlink() {
    await leaveEvent(props.view.code);
    forget();
    props.onUnlinked();
  }
  const pods = () => props.view.tournament.pods;
  const myPod = () => podOf(props.view.tournament, me() ?? '')?.category ?? null;
  const pod = createMemo(
    () => pods().find(p => p.category === (podChoice() ?? myPod())) ?? livePods(props.view.tournament)[0] ?? pods()[0]
  );
  const round = createMemo(() => pod()?.rounds.find(r => r.number === roundChoice()) ?? latestRound(pod()));
  const names = createMemo(() => namesById(props.view.tournament));
  // Read again as each round pairs, in any pod, which is when a late entrant's list goes public (see lateLists.ts);
  // a failed read leaves the names unmarked.
  const [listed] = createResource(
    () => listsPublic(props.view) && [props.view.code, pairedRounds(props.view)].join(' '),
    key =>
      fetchListReaders(key.split(' ')[0] ?? '').then(
        answer => new Set(answer.players),
        () => NO_LISTS
      )
  );
  const divisionOf = (id: string) => props.view.divisions[id] ?? 'masters';
  // A memo: the bar is drawn from it, and a bar drawn again on every new copy drops the search mid-word.
  const started = createMemo(() => hasStarted(props.view.tournament));
  // Whose list the account owns (see DecklistForm): the same owner in a new copy of the event reads nothing again.
  const listOwner = createMemo(
    () => {
      const popId = props.session?.user?.popId;
      const said = props.view.viewer.claim;
      if (isSanctioned(props.view)) {
        return popId ? { popId, firstName: '', lastName: '' } : null;
      }
      return said ? { popId: '', firstName: said.firstName ?? '', lastName: said.lastName ?? '' } : null;
    },
    null,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );

  const tabs = createMemo(() => tabsFor(props.view, listOwner() !== null || holdsDecklist(props.view.code)));
  const tab = () => pickTab(tabs(), params.tab, props.view);

  const bar = (withRounds: boolean, withSearch = true) => (
    <>
      <Show when={pods().length > 1}>
        <Segmented
          options={pods().map(p => ({ value: p.category, label: podLabel(p) }))}
          selected={pod()?.category ?? 'masters'}
          onSelect={value => {
            setPodChoice(value);
            setRoundChoice(null);
          }}
          ariaLabel={t('Division')}
        />
      </Show>
      <Show when={withSearch}>
        <input
          class='search tm-grow'
          type='search'
          placeholder={tab() === 'pairings' ? t('Player or table') : t('Find a player')}
          aria-label={tab() === 'pairings' ? t('Find a player or table') : t('Find a player')}
          value={query()}
          onInput={e => setQuery(e.currentTarget.value)}
        />
      </Show>
      <Show when={withRounds}>
        <RoundSelect
          pod={pod()}
          round={round()}
          // The latest round picked is no round held: the next one to post shows in its place.
          onSelect={n => setRoundChoice(n === latestRound(pod())?.number ? null : n)}
        />
      </Show>
    </>
  );

  /** A search that finds nobody here but somebody in another division says where, and goes there on a press. */
  const miss = (none: string) => {
    const found = foundElsewhere(pods(), pod(), names(), query());
    const shown = pod();
    return found && shown ? (
      <SearchMiss none={t(none, { division: podLabel(shown) })} found={found} onGo={goTo} />
    ) : null;
  };
  const goTo = (to: Pod) => {
    setPodChoice(to.category);
    setRoundChoice(null);
  };

  const now = createNow();
  // Who a viewer is only matters near the start: until then the page is for registering.
  const asks = createMemo(() => me() !== null || (!watching() && asksWhoYouAre(started(), props.view.settings, now())));

  return (
    <>
      <Hero view={props.view} prefer={[podChoice(), myPod()]} mine={me() !== null && started() && asks()} />
      <Show when={props.view.settings.finished}>
        <FinalResults view={props.view} divisionOf={divisionOf} />
      </Show>
      {props.notice}
      <Show when={started() && asks()}>
        <YourMatch
          view={props.view}
          me={me()}
          claim={claim()}
          reportToken={reportToken()}
          reports={reports()}
          onIdentified={identified}
          onForget={forget}
          onWatch={watch}
          pins={PINS_MATCH.has(tab())}
          onView={props.onView}
          onPlayer={setOpen}
          firstRound={firstRoundTime(props.view.settings.startsAt)}
          signedIn={Boolean(props.session?.user)}
          offer={props.session ?? { providers: [] }}
          onUnlink={unlink}
          onStale={() => {
            recheck();
            props.onWhoAmI();
          }}
        />
      </Show>
      <Tabs
        id='event'
        options={tabs()}
        selected={tab()}
        onSelect={value => setParams({ tab: value }, { replace: true })}
        ariaLabel={t('Event sections')}
      />
      <TabPanel tabs='event' selected={tab()}>
        <Show when={tab() === 'pairings'}>
          <section class='tm-box tm-public-pairings'>
            <PublicPairings
              view={props.view}
              pod={pod()}
              round={round()}
              names={names()}
              me={me()}
              query={query()}
              bar={bar}
              following={following()}
              registered={<RegisteredList view={props.view} me={me()} query={query()} onPlayer={setOpen} />}
              onPlayer={setOpen}
              listed={listed() ?? NO_LISTS}
              miss={miss(msg('No tables match in {division}.'))}
            />
            <Show when={started() && deckNote(props.view)}>
              {note => <p class='tm-box-bar tm-box-note muted'>{note()}</p>}
            </Show>
          </section>
        </Show>
        <Show when={tab() === 'standings' && pod()}>
          <Show
            when={started()}
            fallback={<p class='muted tm-empty'>{t('Standings will show here once round 1 is played.')}</p>}
          >
            <StandingsTable
              tournament={props.view.tournament}
              pod={pod()!}
              names={names()}
              decks={props.view.decks}
              divisionOf={divisionOf}
              me={me()}
              query={query()}
              onPlayer={setOpen}
              listed={listed() ?? NO_LISTS}
              bar={bar(false)}
              note={deckNote(props.view)}
              miss={miss(msg('No players match in {division}.'))}
            />
          </Show>
        </Show>
        <Show when={tab() === 'decks'}>
          <DeckStats tournament={props.view.tournament} decks={props.view.decks} />
        </Show>
        <Show when={tab() === 'decklist'}>
          <DecklistForm
            code={props.view.code}
            sanctioned={isSanctioned(props.view)}
            owner={listOwner()}
            open={takingLists(props.view)}
            withdrawable={decklistsOpen(props.view)}
            closes={
              decklistsOpen(props.view) ? timeShown(props.view.settings.startsAt, props.view.settings.timeZone) : null
            }
            checkIn={
              decklistsOpen(props.view) ? timeShown(props.view.settings.checkInAt, props.view.settings.timeZone) : null
            }
            full={rosterFull(props.view)}
            season={eventSeason(props.view.tournament)}
            years={yearsCorrectable(props.view)}
          />
        </Show>
      </TabPanel>
      <Show when={open()}>
        {id => (
          <OpenPlayer
            view={props.view}
            fallback={pod()}
            id={id()}
            me={me()}
            watching={watching()}
            onIdentified={identified}
            onForget={forget}
            onOpen={setOpen}
            names={names()}
            following={following()}
            onFollow={follow}
          />
        )}
      </Show>
    </>
  );
}

/** "No tables match in Masters. Leo Ruiz is in Juniors.", with the division a way there. */
function SearchMiss(props: { none: string; found: { pod: Pod; names: string[] }; onGo: (pod: Pod) => void }) {
  const who = () => {
    const [a = '', b = ''] = props.found.names;
    const more = props.found.names.length - 2;
    if (props.found.names.length === 1) {
      return a;
    }
    return more > 0 ? t('{a}, {b} and {n} more', { a, b, n: more }) : t('{a} and {b}', { a, b });
  };
  const division = (
    <button type='button' class='tm-link-inline' onClick={() => props.onGo(props.found.pod)}>
      {podLabel(props.found.pod)}
    </button>
  );
  return (
    <>
      {props.none}{' '}
      {props.found.names.length === 1
        ? tx('{names} is in {division}.', { names: who(), division })
        : tx('{names} are in {division}.', { names: who(), division })}
    </>
  );
}

/** The loading page's shape: title, status and meta, the logistics, the strip, the tabs and a table. Still, no shimmer. */
function EventSkeleton() {
  const line = (width: string, height = '13px') => <Skeleton width={width} height={height} />;
  return (
    <div class='tm-event-skeleton' aria-busy='true'>
      <div class='tm-event-skeleton-hero'>
        {line('60%', '30px')}
        {line('40%')}
        {line('55%')}
      </div>
      <div class='tm-event-skeleton-hero'>
        {line('70%')}
        {line('45%')}
      </div>
      {line('100%', '56px')}
      <div class='tm-event-skeleton-tabs'>
        {line('64px')}
        {line('64px')}
        {line('64px')}
      </div>
      <Skeleton height='190px' rounded='var(--radius-md)' />
    </div>
  );
}

/** A time the organizer set (the start, which is when registration changes close, or check-in) as players read it; null when none is set. */
const timeShown = (local: string, zone: string): string | null =>
  isWallClock(local) ? eventTimes(local, zone).event : null;

/** Whether the event's own list is at its cap, so the page says so before anyone types. */
const rosterFull = (view: TournamentView): boolean =>
  view.mode === 'swiss' &&
  view.settings.playerCap > 0 &&
  view.tournament.players.filter(player => player.droppedAfter === null).length >= view.settings.playerCap;

/**
 * One date format across the page: the organizer's start time, in the event's
 * zone where it has one, else TOM's start date (see eventDay).
 */
function eventDate({ startsAt, timeZone }: TournamentSettings, startDate: string): string {
  if (startsAt && timeZone) {
    return eventTimes(startsAt, timeZone).event;
  }
  const day = eventDay(startsAt, startDate);
  return startsAt ? `${day} · ${firstRoundTime(startsAt) ?? ''}` : day;
}

/** When the page last changed: a time today, a date before that. */
function updatedLabel(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? timeOfDay(date) : dayLabel(date);
}

/** The dashboard tab an event's page goes back to: Organizing for its staff, Playing for its players. */
function dashboardTab(viewer: TournamentView['viewer']): DashboardTab | undefined {
  if (viewer.role) {
    return 'organizing';
  }
  return viewer.me ? 'playing' : undefined;
}

/** A maps search for the venue, so a phone opens its maps app on the place. */
const mapsLink = (settings: Pick<TournamentSettings, 'venue' | 'address'>) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [settings.venue, settings.address].filter(Boolean).join(', ')
  )}`;

/**
 * The event's head. Once round 1 has started and until the event ends, the
 * player's table matters more than the venue: the venue folds into the meta
 * line as a maps link, the details go, and a viewer whose strip shows the
 * round's clock is not shown it twice. `prefer`: the divisions the status
 * should describe, in order (see eventStatus); the leading clock's follows.
 */
function Hero(props: { view: TournamentView; prefer: (PodCategory | null)[]; mine: boolean }) {
  const now = createClockNow();
  const lead = () => leadDivision(livePods(props.view.tournament), props.view.pending, now());
  const info = () => props.view.tournament.info;
  const settings = () => props.view.settings;
  const status = () =>
    eventStatus(
      props.view.tournament,
      {
        pending: props.view.pending,
        finished: settings().finished,
        firstRound: firstRoundTime(settings().startsAt),
        roundCap: roundCapOf(props.view),
        prefer: [...props.prefer, lead()],
        clock: !(props.mine && underway())
      },
      now()
    ).join(' · ');
  const place = () => [info().city, info().state].filter(Boolean).join(', ');
  const playing = () => livePods(props.view.tournament).some(pod => podProgress(pod, props.view.pending).open > 0);
  const started = () => livePods(props.view.tournament).some(pod => pod.rounds.length > 0);
  const underway = () => started() && !settings().finished;
  const venue = () =>
    underway() &&
    (settings().venue || settings().address) && (
      <a class='tm-link-inline' href={mapsLink(settings())} target='_blank' rel='noopener'>
        {settings().venue || settings().address}
      </a>
    );
  const parts = createMemo(() =>
    [
      eventDate(settings(), info().startDate),
      settings().format,
      settings().entryFee > 0 && t('{amount} entry', { amount: formatFee(settings().entryFee, info().country) }),
      venue() || place(),
      // Before round 1 the status line already counts them.
      started() && tn(props.view.tournament.players.length, '{n} player', '{n} players'),
      // A finished event's date already says when; an unknown time says nothing; mid-round, the clock says the page is live.
      !settings().finished &&
        props.view.updatedAt > 0 &&
        !playing() &&
        t('Updated {time}', { time: updatedLabel(props.view.updatedAt) })
    ].filter(Boolean)
  );
  return (
    <>
      <TournamentHero
        title={info().name}
        tab={dashboardTab(props.view.viewer)}
        status={status()}
        meta={
          <For each={parts()}>
            {(part, i) => (
              <>
                {/* The dot trails the part before it, so a wrapped line never starts on one. */}
                <span class='tm-meta-part'>
                  {part}
                  <Show when={i() < parts().length - 1}>
                    <span class='dot'>·</span>
                  </Show>
                </span>{' '}
              </>
            )}
          </For>
        }
      />
      <Show when={!underway()}>
        <EventLogistics settings={settings()} />
        <Show when={settings().details}>
          <p class='tm-details'>{settings().details}</p>
        </Show>
      </Show>
    </>
  );
}

/**
 * The table a stream overlay shows (`stream=table&table=N`, `pod` to pick a
 * division), or null for none; `scale` sizes the bar for a producer's own
 * layout, from half to twice its size on a 1080p canvas.
 */
function streamOf(params: { stream?: string; table?: string; pod?: string; scale?: string }) {
  const table = Number(params.table);
  if (params.stream !== 'table' || !Number.isInteger(table) || table < 1) {
    return null;
  }
  const pod = POD_CATEGORIES.find(category => category === params.pod);
  const scale = Math.min(2, Math.max(0.5, Number(params.scale) || 1));
  return { table, pod, scale };
}

/**
 * `session`: who is signed in, which the page's own copy of the event cannot
 * say (see createView), and the sign-ins the server offers.
 */
export function PublicEvent(props: { code: string; session: Session | undefined }) {
  const [params] = useSearchParams<{
    screen?: string;
    stream?: string;
    table?: string;
    pod?: string;
    scale?: string;
  }>();
  // The page is the big screen, a stream overlay, or neither, for as long as it is open.
  const stream = streamOf(params);
  const screen = params.screen === '1' || stream !== null;
  // The big screen draws no decks, so it reads the published file even in a staff browser.
  const { view, take, whoAmI, unlinked, retry, freshness } = createView(
    () => props.code,
    () => Boolean(props.session?.user),
    {
      every: screen ? SCREEN_POLL_MS : POLL_MS,
      decks: !screen
    }
  );
  const current = () => latestValue(view);
  const now = createNow();
  // Every clock on the page stops where it was once the page stops hearing from the event.
  const stale = () => staleSince(freshness(), now());
  // A past format's sprites come with its archetype list, loaded only when there are decks to draw.
  const pastFormat = createMemo(() => {
    const shown = current();
    return shown && shown.settings.format !== 'Standard' && Object.keys(shown.decks).length > 0
      ? shown.settings.format
      : null;
  });
  createEffect(() => {
    const format = pastFormat();
    if (format) {
      void import('./deckOptions').then(m => m.learnFormatIcons(format));
    }
  });
  createEffect(() => {
    document.title = pageTitle(current()?.tournament.info.name ?? props.code);
  });
  return (
    <Show
      when={current()}
      fallback={
        // A stream overlay stays clear over the game while it loads, or retries a load that failed.
        <Show when={!stream && view.error} fallback={stream ? null : <EventSkeleton />}>
          <Show
            when={!missing(view.error)}
            fallback={
              <ErrorState
                code={props.code}
                title={t('Event not found')}
                line={t(
                  'There’s no event with the code {code}. Check the code with your organizer, or look for the event by name.',
                  { code: props.code }
                )}
              >
                <a href={`${MAIN_SITE}/tools/event-locator`} class='btn btn-primary'>
                  {t('Find an event')}
                </a>
                <A href='/' class='btn btn-secondary'>
                  {t('Go home')}
                </A>
              </ErrorState>
            }
          >
            <ErrorState
              code={props.code}
              title={t('Couldn’t load this event')}
              line={t('Something went wrong on our side or with your connection. Try again in a moment.')}
            >
              <button type='button' class='btn btn-primary' onClick={() => retry()}>
                {t('Try again')}
              </button>
              <A href='/' class='btn btn-secondary'>
                {t('Go home')}
              </A>
            </ErrorState>
          </Show>
        </Show>
      }
    >
      {v => (
        <StaleSince.Provider value={stale}>
          <Show
            when={!screen}
            fallback={
              <Show when={stream} fallback={<BigScreen view={v()} liveData={freshness()} onRetry={retry} />}>
                {s => <StreamOverlay view={v()} table={s().table} pod={s().pod} scale={s().scale} />}
              </Show>
            }
          >
            <div class='tm-page tm-public'>
              <EventBody
                view={v()}
                session={props.session}
                onView={take}
                onWhoAmI={whoAmI}
                onUnlinked={unlinked}
                notice={<LiveDataStatus data={freshness()} onRetry={retry} />}
              />
            </div>
          </Show>
        </StaleSince.Provider>
      )}
    </Show>
  );
}
