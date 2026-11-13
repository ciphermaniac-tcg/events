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

import { keepBrowserMemory, readBrowserMemory } from '../../lib/tournament/browserMemory';
import { A, useSearchParams } from '@solidjs/router';
import {
  children,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show
} from 'solid-js';
import { lazyOnAir, lazyPanel } from './lazyPanel';
import { eventSeason } from '../../../shared/tournament/divisions';
import { hasStarted, latestRound, livePods, playerPod, podOf, regularRounds } from '../../../shared/tournament/rounds';
import { recordLabel, swissStandings } from '../../../shared/tournament/standings';
import { type Pod, POD_CATEGORIES, type PodCategory, type Round } from '../../../shared/tournament/types';
import type { PlayerClaim } from '../../../shared/tournament/identify';
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
import {
  ApiError,
  fetchListReaders,
  fetchPublished,
  fetchView,
  identifyPlayer,
  leaveEvent,
  type Session
} from '../../lib/tournament/api';
import { ordinal } from '../../lib/format';
import { latestValue } from '../../lib/resource';
import { onChange } from '../../lib/tournament/changes';
import { shared } from '../../lib/tournament/share';
import { holdsDecklist } from '../../lib/tournament/sessionMemory';
import { readFollowing, toggleFollowing } from '../../lib/tournament/spectate';
import {
  askOnReturn,
  createViewPoll,
  firstView,
  lookOnReturn,
  POLL_MS,
  schedulePolls,
  SCREEN_POLL_MS,
  seesMoreThanPublished
} from '../../lib/tournament/viewPoll';
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
import { EMPTY_LIVE_DATA, type LiveData, liveFailure, staleSince } from '../../lib/tournament/liveData';
import { LiveDataStatus } from './LiveDataStatus';
import { MAIN_SITE } from '../../lib/constants';
import { msg, t, timeOfDay, tn, tx } from '../../lib/i18n';
import { keepEventCopy, readEventCopy } from '../../lib/tournament/eventCopies';
import { DAY_MS } from '../../../shared/tournament/limits';

const BigScreen = lazyOnAir(() => import('./BigScreen').then(m => ({ default: m.BigScreen })));
const StreamOverlay = lazyOnAir(() => import('./StreamOverlay').then(m => ({ default: m.StreamOverlay })));
const DeckStats = lazyPanel(() => import('./DeckStats').then(m => ({ default: m.DeckStats })));
const DecklistForm = lazyPanel(() => import('./DecklistForm').then(m => ({ default: m.DecklistForm })));

type Tab = 'pairings' | 'standings' | 'decks' | 'decklist';

/** No event has this code: asking again will not find one. */
const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

const sameViewer = (a: TournamentView['viewer'], b: TournamentView['viewer']) =>
  a.role === b.role && a.me === b.me && a.via === b.via && a.signedIn === b.signedIn;

/**
 * The event, polled while the tab is visible (see lib/tournament/viewPoll.ts),
 * every `every` ms; a poll that finds nothing new costs one tiny request. It
 * also looks the moment the tab is shown again, and when the console in
 * another tab of this browser changes the event. `decks` is whether the page
 * shows decks, the only thing staff see that the published file does not.
 */
function createView(code: () => string, signedIn: () => boolean, options: { every: number; decks: boolean }) {
  // Moved on by every read of who the viewer is, and by their own undo (see fromApi).
  let generation = 0;
  const [freshness, setFreshness] = createSignal<LiveData>(EMPTY_LIVE_DATA);
  const checked = () => setFreshness({ checkedAt: Date.now(), failure: null });
  const failed = (error: unknown) => setFreshness(data => ({ ...data, failure: liveFailure(error) }));
  let retry = () => void reload();
  /**
   * The API's copy, or null when nothing is newer than `since`. What it says
   * of the viewer counts only if nothing since it was asked knows better: a
   * later read of who they are, or their own undo. Its event counts either way.
   */
  async function fromApi(c: string, since?: number): Promise<TournamentView | null> {
    const asked = generation;
    const next = await fetchView(c, since);
    const shown = latestValue(view);
    return next && shown && asked !== generation ? { ...next, viewer: shown.viewer } : next;
  }
  /** Asks the API who the viewer is: the answer outdates every read asked before it. */
  function askWho(c: string): Promise<TournamentView> {
    generation += 1;
    return fromApi(c).then(v => v as TournamentView);
  }
  const [view, { mutate, refetch }] = createResource(code, c =>
    firstView({ published: () => fetchPublished(c), api: () => fromApi(c).then(v => v as TournamentView) })
      .then(next => {
        checked();
        return next;
      })
      .catch((error: unknown) => {
        // With no signal (or no answer the page can use), the copy this device last saw, shown as behind
        // (its clocks stop) until a look finds the event.
        const kept = missing(error) ? null : readEventCopy(c, Date.now());
        if (kept) {
          setFreshness({ checkedAt: kept.savedAt, failure: liveFailure(error), kept: true });
          return kept.view;
        }
        failed(error);
        throw error;
      })
  );
  // Each copy taken is kept for the next load without a signal; an older one never goes back over a newer.
  // Written once a version, not on every look that finds nothing new.
  let keptVersion = '';
  createEffect(() => {
    const shown = latestValue(view);
    const version = shown ? `${shown.code}:${shown.version}:${shown.viewer.role}` : '';
    if (shown && freshness().failure === null && version !== keptVersion) {
      keptVersion = version;
      keepEventCopy(shown, Date.now());
    }
  });
  /**
   * Takes a copy no older than the one shown, of the same event: answers can
   * land out of order. An older one still says who the viewer is, which the
   * copy shown may not know yet.
   */
  function accept(next: TournamentView) {
    const current = latestValue(view);
    if (!current || (current.code === next.code && next.version >= current.version)) {
      mutate(shared(current, next));
    } else if (current.code === next.code && !sameViewer(current.viewer, next.viewer)) {
      mutate({ ...current, viewer: next.viewer });
    }
  }
  // The published file knows nobody. A signed-in viewer's copy comes from the API: staff see
  // decks before the public does, and an account's Player ID marks its player.
  let asked = '';
  createEffect(() => {
    const shown = latestValue(view);
    // Asked once an event: an answer that still knows nobody is not asked for again.
    if (signedIn() && shown && !shown.viewer.signedIn && asked !== shown.code) {
      asked = shown.code;
      void askWho(shown.code)
        .then(accept)
        .catch(() => undefined);
    }
  });
  /** Loads the event again after its first load failed; whether it is there now. */
  async function reload(): Promise<boolean> {
    if (!view.error) {
      return true;
    }
    if (missing(view.error)) {
      return false;
    }
    try {
      return (await refetch()) != null;
    } catch {
      return false;
    }
  }
  /**
   * Asks the API who the viewer is: polls only ask when the event changes, and
   * who the viewer is can change without it (their own action, another of
   * their devices, staff).
   */
  const whoAmI = () =>
    void askWho(code())
      .then(accept)
      .catch(() => undefined);
  onMount(() => {
    let announced = 0;
    const poll = createViewPoll({
      current: () => latestValue(view),
      ownCopy: shown => options.decks && seesMoreThanPublished(shown),
      announced: () => announced,
      reload,
      published: () => fetchPublished(code()),
      api: since => fromApi(code(), since),
      apply: accept,
      now: Date.now,
      checked,
      failed
    });
    const polls = schedulePolls(poll, () => document.hidden, options.every);
    retry = () => {
      poll.retry();
      polls.soon();
    };
    const forget = lookOnReturn(polls);
    // Back in view, a signed-in viewer catches up on a Claim made or released elsewhere.
    const forgetViewer = askOnReturn(() => {
      if (signedIn()) {
        whoAmI();
      }
    }, Date.now);
    // Back in view, the page waits for the look it starts before calling itself behind.
    const shown = () => {
      if (!document.hidden) {
        setFreshness(data => ({ ...data, shownAt: Date.now() }));
      }
    };
    document.addEventListener('visibilitychange', shown);
    const unsubscribe = onChange(code(), version => {
      if (version > (latestValue(view)?.version ?? 0)) {
        announced = Math.max(announced, version);
        polls.soon();
      }
    });
    onCleanup(() => {
      polls.stop();
      unsubscribe();
      forget();
      forgetViewer();
      document.removeEventListener('visibilitychange', shown);
    });
  });
  /** Takes a fresher copy handed over by an action, such as a player's report. */
  function take(published: PublishedView) {
    const current = latestValue(view);
    if (current) {
      accept({ ...published, viewer: current.viewer });
    }
  }
  /** The account is no longer a player here, as its own undo just made it: no need to ask the API. */
  function unlinked() {
    generation += 1;
    const current = latestValue(view);
    if (current) {
      const { role, signedIn } = current.viewer;
      mutate({ ...current, viewer: { role, me: null, via: null, signedIn } });
    }
  }
  return { view, take, whoAmI, unlinked, freshness, retry: () => retry() };
}

const meKey = (code: string) => `cm-tournament-me:${code}`;

/** An event that finished more than a day ago: its page no longer needs to know who the viewer is. */
const pastEvent = (view: TournamentView, now: number) => view.settings.finished && now - view.updatedAt > DAY_MS;
const claimKey = (code: string) => `cm-tournament-player:${code}`;
/** A spectator put away "Which player are you?" for the event, on this device (see createMe). */
const watchKey = (code: string) => `cm-tournament-watching:${code}`;
const tokenKey = (code: string) => `cm-tournament-report:${code}`;

function storedClaim(code: string): PlayerClaim | null {
  try {
    return JSON.parse(readBrowserMemory(claimKey(code)) ?? 'null') as PlayerClaim | null;
  } catch {
    return null;
  }
}

/**
 * Sets or clears a remembered value. The report token and which player this
 * is (a public key) outlast the tab; the Player ID or name proving it does not.
 */
function keep(key: string, value: string | null) {
  keepBrowserMemory(key, value, key.startsWith('cm-tournament-report:') || key.startsWith('cm-tournament-me:'));
}

/**
 * What the device asks the server of its own accord once the page knows who
 * is signed in, once for each player the account is: an account that is the
 * player by its POP ID, where players report and this device holds no token
 * for them, says so, so its account holds the reporting seat if nobody does;
 * and a device that proved who it is before signing in, at an unsanctioned
 * event, says so again with its token, which makes that player the account's
 * Claim.
 */
function accountStep(
  view: TournamentView,
  device: { claim: PlayerClaim | null; token: string | null }
): { claim: PlayerClaim; token?: string } | null {
  const { viewer, settings } = view;
  if (!viewer.signedIn || settings.finished) {
    return null;
  }
  if (viewer.via === 'pop' && viewer.claim && settings.playerReporting && !device.token) {
    return { claim: viewer.claim };
  }
  const { claim, token } = device;
  return viewer.via === null && !isSanctioned(view) && claim && token ? { claim, token } : null;
}

/**
 * Which player the viewer is: the one their account is (by its POP ID, or
 * its Claim), or the one they proved on this device with a Player ID or last
 * name (see Identify). A player marked on this device before proof was asked
 * for is not taken on its word, and what this device proved for another
 * player says nothing for the account's. The viewer reports from here when
 * this device holds the token, or when their account holds the player's
 * seat: its Claim does, and the server says so of its POP ID when asked. That
 * answer is the account's, not the device's: nothing of it is kept here, and
 * it counts only while the account is still that player.
 */
function createMe(view: () => TournamentView, events: { onView: (view: PublishedView) => void; onLinked: () => void }) {
  const code = () => view().code;
  const stored = storedClaim(code());
  const [claim, setClaim] = createSignal(stored);
  const [chosen, setChosen] = createSignal(readBrowserMemory(meKey(code()), true));
  const [reportToken, setReportToken] = createSignal(stored ? readBrowserMemory(tokenKey(code()), true) : null);
  /** The player whose seat the account holds, as the server last answered; no token goes with that. */
  const [accountSeat, setAccountSeat] = createSignal<string | null>(null);
  const [watching, setWatching] = createSignal(readBrowserMemory(watchKey(code()), true) !== null);
  /** Whether the viewer only watches: set from the question's close, and let go once they say who they are. */
  function watch(on: boolean) {
    keepBrowserMemory(watchKey(code()), on ? '1' : null, true);
    setWatching(on);
  }
  function identified(found: Identified) {
    watch(false);
    keep(meKey(code()), found.key);
    keep(claimKey(code()), found.lookup ? null : JSON.stringify(found.claim));
    setChosen(found.key);
    setClaim(found.lookup ? null : found.claim);
    // A new token when this device just became the one that reports; none kept for a lookup.
    const token = found.reportToken ?? (found.lookup ? null : reportToken());
    keep(tokenKey(code()), token);
    setReportToken(token);
    setAccountSeat(found.linked && found.reporter ? found.key : null);
    events.onView(found.view);
    // A Claim just made is news to the page's copy, which says who the viewer is as of its last API read.
    if (found.linked && view().viewer.me !== found.key) {
      events.onLinked();
    }
  }
  function forget() {
    [meKey, claimKey, tokenKey].forEach(key => keep(key(code()), null));
    setChosen(null);
    setClaim(null);
    setReportToken(null);
  }
  // A device that said who the player is before reporting took a token asks for one now, if nobody has it.
  async function claimNow(said: PlayerClaim, token?: string) {
    const answer = await identifyPlayer(code(), said, token).catch(() => null);
    if (answer?.key) {
      identified({ ...answer, claim: said, key: answer.key });
    }
  }
  /** Whether the account holds its player's seat by its POP ID: asked as the account, so the device keeps nothing. */
  async function seat(said: PlayerClaim) {
    const answer = await identifyPlayer(code(), said).catch(() => null);
    if (answer?.key) {
      setAccountSeat(answer.linked && answer.reporter ? answer.key : null);
      events.onView(answer.view);
    }
  }
  onMount(() => {
    const said = claim();
    if (said && !reportToken()) {
      void claimNow(said);
    }
  });
  // Which player this is, kept across tabs, is let go a day after the event finishes.
  createEffect(() => {
    if (chosen() !== null && pastEvent(view(), Date.now())) {
      keep(meKey(code()), null);
      setChosen(null);
    }
  });
  // A confirmed selection stays the displayed target even when another account player signs in.
  const selected = () => chosen() !== null;
  const looking = () => selected() && claim() === null;
  const me = () => chosen() ?? view().viewer.me;
  const ownClaim = () => (selected() ? claim() : (view().viewer.claim ?? null));
  const ownToken = () => (selected() ? reportToken() : null);
  const accountReports = () => {
    const { viewer } = view();
    return viewer.me !== null && viewer.me === me() && (accountSeat() === viewer.me || viewer.via === 'claim');
  };
  // The player the account last stepped as (see accountStep): it steps again as another, or once a report is refused.
  const [stepped, setStepped] = createSignal<string | null>(null);
  createEffect(() => {
    const as = view().viewer.me ?? '';
    const step = stepped() === as ? null : accountStep(view(), { claim: ownClaim(), token: ownToken() });
    if (step) {
      setStepped(as);
      void (step.token ? claimNow(step.claim, step.token) : seat(step.claim));
    }
  });
  return {
    me,
    claim: ownClaim,
    reportToken: ownToken,
    reports: () => !looking() && (ownToken() !== null || accountReports()),
    identified,
    forget,
    watching,
    watch: () => watch(true),
    /** A report was refused: the account's seat may have gone to another device since it last asked. */
    recheck: () => setStepped(null)
  };
}

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

  // A choice of one is no choice: a lone section draws no tab row, and its content stands alone.
  const panel = children(() => (
    <>
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
    </>
  ));

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
      <Show when={tabs().length > 1} fallback={panel()}>
        <Tabs
          id='event'
          options={tabs()}
          selected={tab()}
          onSelect={value => setParams({ tab: value }, { replace: true })}
          ariaLabel={t('Event sections')}
        />
        <TabPanel tabs='event' selected={tab()}>
          {panel()}
        </TabPanel>
      </Show>
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
                  <Show when={i() < parts().length - 1}> ·&nbsp;</Show>
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
