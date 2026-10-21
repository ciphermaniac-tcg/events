/**
 * /host/:code: running an event. Staff land here from their list or from an
 * invite link (`?invite=`), which adds them to the event's staff on the way in.
 */

import { divisionLookup } from '../../../shared/tournament/divisions';
import { A, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  lazy,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack
} from 'solid-js';
import { activeIds, cutPodsOf, latestRound, livePods, roundComplete } from '../../../shared/tournament/rounds';

import { eventTypeOf } from '../../../shared/tournament/structure';
import type { Pod, PodCategory } from '../../../shared/tournament/types';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { LockedTab, TabPanel, Tabs } from '@ciphermaniac/design/components/Tabs';
import { msg, t, tn, tx } from '../../lib/i18n';
import { errorText, joinStaff, type Manage } from '../../lib/tournament/api';
import {
  type DivisionCut,
  divisionCuts,
  namesById,
  type NextStep,
  nextStep,
  podLabel,
  podProgress,
  type PodProgress,
  roundStatus,
  shownDecks,
  swissPlanOf,
  unseated
} from '../../lib/tournament/present';
import { session } from './session';
import { latestValue } from '../../lib/resource';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { SessionGate } from './SessionGate';
import { ErrorLine } from './Field';
import { lookOnReturn, schedulePolls } from '../../lib/tournament/viewPoll';
import { LiveDataStatus } from './LiveDataStatus';
import { createManage, type ManageState } from './manageState';
import '../../styles/pages/tournament-console.css';
import { ClockControls } from './RoundControls';
import { EndEventStep, type RoundEnd, RoundEndSplit } from './NextStep';
import { createTomLink, type Lapse, type TomLink, TomStatus } from './TomSyncPanel';
import { createDropGate, podDrops } from './dropGate';
import { Trail } from './Trail';
import { pageTitle } from '../../lib/title';

// Pairings is the tab a running event lives on, so only it loads with the page;
// the others load when opened (decklists are read before the event, the
// players and settings tabs mostly before it too, standings between rounds).
const DecklistsPanel = lazy(() => import('./DecklistsPanel').then(m => ({ default: m.DecklistsPanel })));
const PenaltiesPanel = lazy(() => import('./PenaltiesPanel').then(m => ({ default: m.PenaltiesPanel })));
const PlayersPanel = lazy(() => import('./PlayersPanel').then(m => ({ default: m.PlayersPanel })));
const StandingsTable = lazy(() => import('./StandingsTable').then(m => ({ default: m.StandingsTable })));
const EventPanel = lazy(() => import('./EventPanel').then(m => ({ default: m.EventPanel })));
// Asked for now, beside the event, rather than once the event has arrived; a failure is the tab's to show.
const roundPanel = import('./RoundPanel');
roundPanel.catch(() => undefined);
const RoundPanel = lazy(() => roundPanel.then(m => ({ default: m.RoundPanel })));
// Only a signed-out visitor sees it, and the console waited on it before it could ask for the event.
const SignIn = lazy(() => import('./SignIn').then(m => ({ default: m.SignIn })));

type Tab = 'round' | 'players' | 'standings' | 'decklists' | 'penalties' | 'event';

type TabOption = { value: Tab; label: string; locked?: string };

const PAIRINGS_LOCKED = msg('Pairings open once round 1 starts.');
const PENALTIES_LOCKED = msg('Penalty notes open once round 1 is paired.');

const TABS: TabOption[] = [
  { value: 'round', label: msg('Pairings') },
  { value: 'players', label: msg('Players') },
  { value: 'standings', label: msg('Standings') },
  { value: 'decklists', label: msg('Decklists') },
  { value: 'penalties', label: msg('Penalties') },
  { value: 'event', label: msg('Settings') }
];

/** Other staff change the event too; the console looks again this often while visible. */
const REFRESH_MS = 15_000;

/** A division with no pod yet: nothing paired, nothing playing. */
const NO_PROGRESS: PodProgress = { round: undefined, tables: 0, open: 0, champion: null, label: '', next: '' };

/** What a TOM event's head says to do once following its file stops, by why. */
const TOM_LAPSES: Record<Lapse, string> = {
  permission: msg('allow access to the .tdf to enter results'),
  unreadable: msg('pick the .tdf again to enter results'),
  conflict: msg('reconnect the .tdf to enter results')
};

/** What a TOM event's head adds to the round: whether TOM has every result entered here. */
function tomPart(tom: TomLink): string {
  if (tom.locked()) {
    return t(TOM_LAPSES[tom.lapse()]);
  }
  const n = tom.pending();
  return n ? tn(n, '{n} result to write', '{n} results to write') : t('TOM has every result');
}

/** Pairing the pod's next round or stage, asking first about any drop request still open (see dropGate). */
function PairButton(props: {
  state: ManageState;
  manage: Manage;
  pod: Pod | undefined;
  label: string;
  ready: boolean;
  primary?: boolean;
}) {
  const gate = createDropGate({
    state: () => props.state,
    manage: () => props.manage,
    pod: () => props.pod
  });
  return (
    <>
      <button
        type='button'
        class={props.primary === false ? 'btn btn-secondary' : 'btn btn-primary'}
        classList={{ 'is-waiting': !props.ready }}
        disabled={!props.ready || props.state.busy()}
        onClick={() => gate.pair()}
      >
        {props.label}
      </button>
      {gate.dialog(props.label)}
    </>
  );
}

/** What the disabled step says while the round plays, when it is not pairing. */
const WAITING_WORDS: Partial<Record<RoundEnd, string>> = { cut: msg('Start top cut'), end: msg('End event') };

/**
 * The end of a Swiss round: the step the plan calls for as one button, the
 * others behind its caret (see RoundEndSplit). While the round is still
 * playing, only that step shows, disabled, with the reason under it.
 */
function RoundEndStep(props: {
  state: ManageState;
  manage: Manage;
  pod: Pod;
  label: string;
  ready: boolean;
  step: RoundEnd;
  cuts: readonly DivisionCut[];
  /** The pod's divisions have begun their top cuts: its Swiss rounds are over, and only the others' cuts are left. */
  swissOver: boolean;
}) {
  const open = () => props.cuts.filter(c => !c.started);
  // A League Challenge plays Swiss rounds only.
  const canCut = () =>
    !props.pod.prereleaseConcluded &&
    eventTypeOf(props.manage.tournament) !== 'challenge' &&
    (props.step === 'cut' || open().some(c => c.active >= 4));
  return (
    <Show
      when={props.ready}
      fallback={
        <button type='button' class='btn btn-primary is-waiting' disabled>
          {t(WAITING_WORDS[props.step] ?? props.label)}
        </button>
      }
    >
      <RoundEndSplit
        state={props.state}
        manage={props.manage}
        pod={props.pod}
        label={props.label}
        step={props.step}
        cuts={props.cuts}
        canCut={canCut()}
        swissOver={props.swissOver}
      />
    </Show>
  );
}

/**
 * The console's head, the same on every tab: the event, where its round
 * stands, and the step to take next. TOM pairs a TOM event's rounds, so
 * its head says instead when TOM last saved the file, with the results TOM
 * does not have yet to write into it, or the file to reconnect (see
 * TomSyncPanel).
 */
function Hero(props: { state: ManageState; manage: Manage; pod: Pod | undefined; tom: TomLink | null }) {
  const finished = () => props.manage.settings.finished;
  const progress = () => (props.pod ? podProgress(props.pod, props.manage.pending) : NO_PROGRESS);
  const waiting = () =>
    props.manage.mode === 'swiss' && props.pod ? unseated(props.manage.tournament, props.pod).length : 0;
  const active = () => (props.pod ? activeIds(props.manage.tournament, props.pod).length : 0);
  const cuts = createMemo(() =>
    props.pod ? divisionCuts(props.manage.tournament, props.pod, divisionLookup(props.manage.tournament)) : []
  );
  const swissOver = () => (props.pod ? cutPodsOf(props.manage.tournament, props.pod).length > 0 : false);
  // A division's bracket, or another pod paired apart, still playing: the event is not over for them.
  const othersPlaying = () =>
    livePods(props.manage.tournament).some(p => {
      const round = latestRound(p);
      return p.category !== props.pod?.category && round !== undefined && !roundComplete(round);
    });
  const plan = () =>
    props.pod ? swissPlanOf(props.manage.tournament, props.pod, props.manage.settings.roundCap) : null;
  /** The lead of the meta line: where the round stands, then what else needs saying about it. */
  const lead = () => {
    const { tom } = props;
    const extra = tom
      ? [tomPart(tom)]
      : [
          ...(waiting() ? [t('{n} not seated', { n: waiting() })] : []),
          ...(swissOver() ? [t('top cuts under way')] : [])
        ];
    const rounds = tom ? null : (plan()?.rounds ?? null);
    // A console that cannot reach the site says so, rather than showing an old round as the current one.
    const stale = props.state.loadError() ? [t('not updating')] : [];
    return [roundStatus(progress(), finished(), rounds), ...extra, ...stale].join(' · ');
  };
  /** The round whose clock the head runs: the pod's latest, until it is finished or crowns a champion. */
  const clockRound = () => {
    const { round } = progress();
    return round && round.status !== 'finished' && !progress().champion && !finished() ? round : null;
  };
  const step = () => (props.tom ? ({ kind: 'none' } as NextStep) : nextStep(progress(), finished(), plan()));
  const pairStep = () => {
    const s = step();
    return s.kind === 'pair' ? s : null;
  };
  const decideStep = () => {
    const s = step();
    return s.kind === 'decide' ? s : null;
  };
  /** The champion is known; a third-place match still playing holds the end back. */
  const closeStep = () => {
    const s = step();
    return s.kind === 'close' ? s : null;
  };
  /** A Swiss round's end, as RoundEndStep lays it out; round one and the top cut's rounds only pair. */
  const roundEnd = () => {
    const s = step();
    if (s.kind === 'decide' || (s.kind === 'pair' && swissOver() && cuts().some(c => !c.started && c.cut > 0))) {
      const cut = plan()?.cut ?? 0;
      return { ...s, end: (cut > 0 ? 'cut' : 'end') as RoundEnd };
    }
    return s.kind === 'pair' && progress().round?.kind === 'swiss' ? { ...s, end: 'pair' as RoundEnd } : null;
  };
  const firstBlocked = () => pairStep() !== null && !progress().round && active() < 2;
  /** Whether the main step pairs a round now: not a top cut or the end, which no drop request holds back. */
  const pairsNow = () => {
    const end = roundEnd();
    return end ? end.end === 'pair' && end.ready : Boolean(pairStep()?.ready);
  };
  // Players who asked to drop are answered before the next round pairs them (see dropGate).
  const drops = () => (pairsNow() ? podDrops(props.manage, props.pod).length : 0);
  const reason = () => {
    if (firstBlocked()) {
      return t('Add players to pair');
    }
    return drops()
      ? tn(drops(), '{n} drop request waiting', '{n} drop requests waiting')
      : (pairStep() ?? decideStep() ?? closeStep())?.reason;
  };
  // The open tables need no saying twice: the lead already counts them.
  const openTablesOnly = () => reason() === tn(progress().open, '{n} table open', '{n} tables open');
  const action = (
    <Switch>
      <Match when={props.tom}>{tom => <TomStatus link={tom()} />}</Match>
      <Match when={props.pod && roundEnd()}>
        {s => (
          <RoundEndStep
            state={props.state}
            manage={props.manage}
            pod={props.pod as Pod}
            label={s().label}
            ready={s().ready}
            step={s().end}
            cuts={cuts()}
            swissOver={swissOver()}
          />
        )}
      </Match>
      <Match when={pairStep()}>
        {s => (
          <PairButton
            state={props.state}
            manage={props.manage}
            pod={props.pod}
            label={s().label}
            ready={s().ready && !firstBlocked()}
          />
        )}
      </Match>
      <Match when={closeStep()}>
        {s => (
          <Show
            when={s().ready}
            fallback={
              <button type='button' class='btn btn-primary is-waiting' disabled>
                {t('End event')}
              </button>
            }
          >
            <EndEventStep state={props.state} manage={props.manage} primary={!othersPlaying()} />
          </Show>
        )}
      </Match>
    </Switch>
  );
  return (
    <>
      <Trail here={props.manage.tournament.info.name} tab='organizing' />
      <section class='tm-hero tm-console-hero'>
        <div class='tm-console-title'>
          <div class='tm-hero-text'>
            <h1>{props.manage.tournament.info.name}</h1>
            {/* Each part keeps the dot after it, so the line wraps between parts and never starts on a dot. */}
            <p class='hero-meta'>
              <span class='tm-meta-part tm-meta-lead'>
                {lead()}
                <span class='dot'>·</span>
              </span>
              <span class='tm-meta-part'>
                <span class='num'>{props.manage.code}</span>
                <span class='dot'>·</span>
              </span>
              <span class='tm-meta-part'>
                {props.manage.mode === 'tom' ? t('Run in TOM') : t('Swiss on this site')}
                <span class='dot'>·</span>
              </span>
              <span class='tm-meta-part'>
                {tn(props.manage.tournament.players.length, '{n} player', '{n} players')}
                <span class='dot'>·</span>
              </span>
              <span class='tm-meta-part'>
                <A href={`/t/${props.manage.code}`}>{t('Public page')}</A>
                <span class='dot'>·</span>
              </span>
              {/* Its own tab, since it goes on the projector while the console keeps running. */}
              <a href={`/t/${props.manage.code}?screen=1`} target='_blank' rel='noopener'>
                {t('Big screen')}
              </a>
            </p>
          </div>
        </div>
        <div class='tm-console-steps'>
          <Show when={props.pod && clockRound()}>
            {round => <ClockControls state={props.state} pod={props.pod as Pod} round={round()} class='is-large' />}
          </Show>
          <span class='tm-grow' />
          <div class='tm-next'>
            {action}
            <Show when={reason() && !openTablesOnly()}>
              <span class='tm-next-reason'>{reason()}</span>
            </Show>
          </div>
        </div>
      </section>
    </>
  );
}

const TAB_ICONS: Record<Tab, JSX.Element> = {
  round: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <path d='M3 10h18M12 10v10' />
    </svg>
  ),
  players: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='9' cy='8' r='3.5' />
      <path d='M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3 2.4 3.5 5.2' />
    </svg>
  ),
  standings: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M4 20V11h5v9M9 20V5h6v15M15 20v-6h5v6' />
    </svg>
  ),
  decklists: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <rect x='5' y='3' width='14' height='18' rx='2' />
      <path d='M9 8h6M9 12h6M9 16h4' />
    </svg>
  ),
  penalties: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M5 21V4M5 4h12l-2.5 4.5L17 13H5' />
    </svg>
  ),
  event: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='12' cy='12' r='3' />
      <path d='M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1' />
    </svg>
  )
};

/** A phone's tabs, in a bar along the bottom of the screen as the dashboard's are; the strip above serves wider screens. */
function TabBar(props: { tabs: TabOption[]; selected: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav class='tm-console-bar' aria-label={t('Event sections')}>
      <For each={props.tabs}>
        {option => (
          <Show
            when={option.locked}
            fallback={
              <button
                type='button'
                aria-current={option.value === props.selected ? 'page' : undefined}
                onClick={() => props.onSelect(option.value)}
              >
                {TAB_ICONS[option.value]}
                <span>{option.label}</span>
              </button>
            }
          >
            {hint => (
              <LockedTab hint={hint()}>
                {TAB_ICONS[option.value]}
                <span>{option.label}</span>
              </LockedTab>
            )}
          </Show>
        )}
      </For>
    </nav>
  );
}

/**
 * Why something the console tried did not happen, above the tabs, and
 * brought into view when it is set (`follow`): a row action far down the
 * roster would otherwise fail out of sight. Pairings keeps a failed result in
 * its row, so there the page stays where it is.
 */
function ConsoleError(props: { message: string | null; follow: boolean }) {
  let line: HTMLDivElement | undefined;
  createEffect(
    on(
      () => props.message,
      message => {
        if (message && untrack(() => props.follow)) {
          queueMicrotask(() => line?.scrollIntoView({ block: 'nearest' }));
        }
      }
    )
  );
  // Only while there is something to say, so an empty line takes no room in the page.
  return (
    <Show when={props.message}>
      <div ref={line}>
        <ErrorLine message={props.message} />
      </div>
    </Show>
  );
}

/** Whether any pod has a round paired: until then the Pairings tab has nothing to show. */
const hasStarted = (manage: Manage) => manage.tournament.pods.some(p => latestRound(p) !== undefined);

/**
 * The Players tab counts the requests waiting on staff, so one is seen from
 * any tab: drops apart from the rest, since a drop holds back the next round.
 */
function withRequests(option: TabOption, manage: Manage): TabOption {
  const open = (manage.requests ?? []).filter(request => request.status === 'open');
  const drops = open.filter(request => request.kind === 'drop').length;
  const others = open.length - drops;
  const counts = [others ? String(others) : '', drops ? tn(drops, '{n} drop', '{n} drops') : ''].filter(Boolean);
  return option.value === 'players' && counts.length
    ? { ...option, label: [option.label, ...counts].join(' · ') }
    : option;
}

/** Until round 1 is paired, Pairings has nothing to show and a penalty has no round to be noted in. */
const UNTIL_STARTED: Partial<Record<Tab, string>> = { round: PAIRINGS_LOCKED, penalties: PENALTIES_LOCKED };

/** The console's tabs: Decklists only while the event takes them, Pairings and Penalties locked until round 1. */
const tabsFor = (manage: Manage): TabOption[] =>
  TABS.filter(option => option.value !== 'decklists' || manage.settings.decklists !== 'off').map(option => {
    const locked = hasStarted(manage) ? undefined : UNTIL_STARTED[option.value];
    const shown = { ...option, label: t(option.label) };
    return withRequests(locked ? { ...shown, locked: t(locked) } : shown, manage);
  });

/** The tab the console opens on: Pairings once the event is running, Players before it. */
const defaultTab = (manage: Manage): Tab => (hasStarted(manage) ? 'round' : 'players');

function Console(props: { state: ReturnType<typeof createManage>; manage: Manage }) {
  // In the URL, so a reload mid-event comes back to the same tab.
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const tabs = () => tabsFor(props.manage);
  const tab = (): Tab =>
    tabs().some(option => option.value === params.tab && !option.locked)
      ? (params.tab as Tab)
      : defaultTab(props.manage);
  const setTab = (value: Tab) =>
    setParams({ tab: value === defaultTab(props.manage) ? undefined : value }, { replace: true });
  const [podChoice, setPodChoice] = createSignal<PodCategory | null>(null);
  const pods = () => props.manage.tournament.pods;
  // Until one is picked, the first pod still in play: a pod whose divisions have cut has nothing left to pair.
  const pod = createMemo(
    () => pods().find(p => p.category === podChoice()) ?? livePods(props.manage.tournament)[0] ?? pods()[0]
  );
  const names = createMemo(() => namesById(props.manage.tournament));
  const divisionOf = createMemo(() => divisionLookup(props.manage.tournament));
  // A TOM event's file is linked for as long as the console is open, whatever the tab.
  const tom =
    // eslint-disable-next-line solid/reactivity -- an event's mode never changes, and the link lives as long as the console
    props.manage.mode === 'tom'
      ? createTomLink({
          manage: () => props.manage,
          onSynced: async answer => (answer ? props.state.take(answer) : props.state.load())
        })
      : null;
  return (
    <div class='tm-page tm-console' classList={{ 'is-pairings': tab() === 'round' }}>
      <Hero state={props.state} manage={props.manage} pod={pod()} tom={tom} />
      <Tabs id='console' options={tabs()} selected={tab()} onSelect={setTab} ariaLabel={t('Event sections')} />
      <TabBar tabs={tabs()} selected={tab()} onSelect={setTab} />
      <Show when={tom}>{link => <ErrorLine message={link().error()} />}</Show>
      <Show when={pods().length > 1 && (tab() === 'round' || tab() === 'standings')}>
        <Segmented
          options={pods().map(p => ({ value: p.category, label: podLabel(p) }))}
          selected={pod()?.category ?? 'masters'}
          onSelect={setPodChoice}
          ariaLabel={t('Division')}
        />
      </Show>
      <ConsoleError message={props.state.error()} follow={tab() !== 'round'} />
      <TabPanel tabs='console' selected={tab()}>
        <Show when={tab() === 'round'}>
          <Show when={pod()} fallback={<p class='muted'>{t('Add players to start pairing.')}</p>}>
            {p => <RoundPanel state={props.state} manage={props.manage} pod={p()} locked={tom?.locked() ?? false} />}
          </Show>
        </Show>
        <Show when={tab() === 'players'}>
          <PlayersPanel state={props.state} manage={props.manage} />
        </Show>
        <Show when={tab() === 'standings'}>
          <Show when={pod()}>
            {p => (
              <StandingsTable
                tournament={props.manage.tournament}
                pod={p()}
                names={names()}
                decks={shownDecks(props.manage)}
                divisionOf={divisionOf()}
                tiebreakers
                hideCutDecks={props.manage.settings.deckVisibility !== 'always' && !props.manage.settings.finished}
              />
            )}
          </Show>
        </Show>
        <Show when={tab() === 'decklists'}>
          <DecklistsPanel state={props.state} manage={props.manage} />
        </Show>
        <Show when={tab() === 'penalties'}>
          <PenaltiesPanel state={props.state} manage={props.manage} />
        </Show>
        <Show when={tab() === 'event'}>
          <EventPanel state={props.state} manage={props.manage} tom={tom} />
        </Show>
      </TabPanel>
    </div>
  );
}

/**
 * Why the console did not open, and who asked: a refusal is almost always the
 * wrong account, so switching is one press away.
 */
function Refused(props: { message: string | undefined; name: string | undefined }) {
  return (
    <Show when={props.message}>
      <ErrorLine message={props.message} />
      <p class='muted'>
        {tx('Signed in as {name}. {link}', {
          name: props.name,
          link: <A href='/settings'>{t('Switch account in Settings')}</A>
        })}
      </p>
    </Show>
  );
}

export function ManageEvent(props: { code: string }) {
  const [params] = useSearchParams<{ invite?: string }>();
  const state = createManage(() => props.code);
  const [joinError, setJoinError] = createSignal<string | null>(null);
  const user = () => latestValue(session)?.user;

  /** An invite link joins the staff first, which takes the account; the event is then read as staff. */
  async function join(code: string, invite: string) {
    await joinStaff(code, invite).catch(err => setJoinError(errorText(err)));
    await state.load();
  }

  // Without an invite the event is read at once, beside the account: the server says who may.
  // Someone signed in, not each answer about them: a kept session read again must not join twice.
  const signedIn = createMemo(() => Boolean(user()));
  createEffect(() => {
    const { code } = props;
    const { invite } = params;
    if (invite && !signedIn()) {
      return;
    }
    // Untracked: the read looks at the copy it holds, and must not run again each time that copy changes.
    untrack(() => void (invite ? join(code, invite) : state.load()));
  });

  onMount(() => {
    // One look at a time, waiting longer after each that fails, and at once when the tab is back in view.
    const polls = schedulePolls(
      () => (state.data() && !state.busy() ? state.load() : Promise.resolve(true)),
      () => document.hidden,
      REFRESH_MS
    );
    const forget = lookOnReturn(polls);
    onCleanup(() => {
      polls.stop();
      forget();
    });
  });

  createEffect(() => {
    document.title = pageTitle(state.data()?.tournament.info.name ?? props.code);
  });

  return (
    <SessionGate>
      {s => (
        <Show
          when={user()}
          fallback={
            <SignIn offer={s()} next={`/host/${props.code}${params.invite ? `?invite=${params.invite}` : ''}`} />
          }
        >
          <ErrorLine message={joinError()} />
          <Show
            when={state.data()}
            fallback={
              <Show when={state.loadError()} fallback={<Skeleton height='240px' />}>
                <Show
                  when={state.loadError()?.status === 401 || state.loadError()?.status === 403}
                  fallback={
                    <p class='muted'>
                      {state.loadError()?.status === 0
                        ? t('Connection unavailable. Try again.')
                        : t(state.loadError()?.message ?? '')}
                    </p>
                  }
                >
                  <Refused message={t(state.loadError()?.message ?? '')} name={user()?.name} />
                </Show>
                <button type='button' class='btn btn-secondary' onClick={() => void state.load()}>
                  {t('Retry')}
                </button>
              </Show>
            }
          >
            {manage => (
              <>
                <LiveDataStatus data={state.freshness()} onRetry={() => void state.load()} />
                <Console state={state} manage={manage()} />
              </>
            )}
          </Show>
        </Show>
      )}
    </SessionGate>
  );
}
