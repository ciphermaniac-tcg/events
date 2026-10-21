/**
 * The projector view (`/t/:code?screen=1`), read from across a room. It
 * follows the event through five layouts (see screenPhase), each rising in
 * as the last gives way:
 *
 * Before round 1, everyone registered by first name, for a player to check
 * they are in, beside a large QR code and the event code. Once a round is
 * paired, its tables in order: both players face each other across the
 * table number, each with the record they brought into the round, counting the table's
 * result as soon as it is in. Once the
 * clock starts, the clock is the largest thing on the screen and the tables
 * run under it. Once every table has a result, the tables again with each
 * result in the middle, for the room to check before the next round. Once
 * the event ends, the standings, with each player's archetype once decks show.
 *
 * Every list scrolls itself when it does not fit, at the speed set on the
 * screen. The header carries the event's name and status, and after round 1
 * a small QR code and the event code. The scroll speed, and once a top cut
 * has started whether it shows as tables or as a bracket, are for whoever is
 * at the laptop: the controls show while the pointer moves, S cycles the
 * speed, B switches the view, and both are remembered on the device. The
 * site's chrome is hidden while it is up.
 */

import { createMemo, createSignal, For, Index, type JSX, lazy, onCleanup, onMount, Show, useContext } from 'solid-js';
import { percentLabel, recordLabel } from '../../../shared/tournament/standings';
import type { Match, Pod, Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { DEFAULT_DISPLAY, type DisplayOptions } from '../../../shared/tournament/display';
import { displayFont, pagedDisplay } from './displayLayout';
import { screenWakeLock } from './wakeLock';
import { PagedDisplay } from './PagedDisplay';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { cutSeeds } from '../../lib/tournament/bracket';
import {
  divisionHeading,
  eventStatus,
  firstRoundTime,
  hasCut,
  markText,
  type MatchView,
  matchViews,
  namesById,
  podLabel,
  podStandings,
  recordsSoFar,
  roundCapOf,
  seatMark,
  shownOutcome
} from '../../lib/tournament/present';
import { type ScreenPhase, screenPhase } from '../../lib/tournament/screen';
import { latestRound, livePods, sortMatches, withSwiss } from '../../../shared/tournament/rounds';
import type { LiveData } from '../../lib/tournament/liveData';
import { LiveDataStatus } from './LiveDataStatus';
import { DivisionClocks } from './DivisionClocks';
import { divisionClocks } from './clockOrder';
import { StaleSince } from './Clock';
import { DeckIcons } from './DeckIcons';
import { createNow } from './now';
import { QrCode } from './QrCode';
import { msg, t } from '../../lib/i18n';
import '../../styles/pages/tournament-screen.css';

const STEP_MS = 40;
const PAUSE_MS = 4000;
const CONTROLS_MS = 3000;
const SPEED_KEY = 'cm-screen-autoscroll';
const VIEW_KEY = 'cm-screen-view';

type Speed = 'off' | 'slow' | 'moderate' | 'fast';

const SPEEDS: { value: Speed; label: string }[] = [
  { value: 'off', label: msg('Off') },
  { value: 'slow', label: msg('Slow') },
  { value: 'moderate', label: msg('Moderate') },
  { value: 'fast', label: msg('Fast') }
];

/** Pixels per step: the shipped pace of a pixel every 40ms is Slow. */
const PIXELS: Record<Speed, number> = { off: 0, slow: 1, moderate: 2, fast: 4 };

/** The stored speed; an older "on" is the old pace, Slow. */
function storedSpeed(): Speed {
  const stored = localStorage.getItem(SPEED_KEY);
  if (stored === null && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 'off';
  }
  if (stored === 'on') {
    return 'slow';
  }
  return SPEEDS.some(s => s.value === stored) ? (stored as Speed) : 'slow';
}

/** Scrolls `el` down `step()` pixels at a time, pausing at each end, while it overflows. */
function autoScroll(el: HTMLElement, step: () => number): () => void {
  let pausedUntil = Date.now() + PAUSE_MS;
  let reset: ReturnType<typeof setTimeout> | undefined;
  const timer = setInterval(() => {
    if (step() === 0 || Date.now() < pausedUntil || el.scrollHeight <= el.clientHeight) {
      return;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
      pausedUntil = Date.now() + PAUSE_MS;
      reset = setTimeout(() => {
        if (step() > 0) {
          el.scrollTo({ top: 0 });
        }
      }, PAUSE_MS / 2);
      return;
    }
    el.scrollTop += step();
  }, STEP_MS);
  return () => {
    clearInterval(timer);
    clearTimeout(reset);
  };
}

function createScreenPrefs() {
  const [speed, setSpeedSignal] = createSignal<Speed>(storedSpeed());
  const setSpeed = (next: Speed) => {
    localStorage.setItem(SPEED_KEY, next);
    setSpeedSignal(next);
  };
  const cycle = () => setSpeed(SPEEDS[(SPEEDS.findIndex(s => s.value === speed()) + 1) % SPEEDS.length].value);
  const [view, setViewSignal] = createSignal<MatchView>(
    localStorage.getItem(VIEW_KEY) === 'bracket' ? 'bracket' : 'table'
  );
  const setView = (next: MatchView) => {
    localStorage.setItem(VIEW_KEY, next);
    setViewSignal(next);
  };
  const toggleView = () => setView(view() === 'bracket' ? 'table' : 'bracket');
  return { speed, setSpeed, cycle, view, setView, toggleView };
}

type Prefs = ReturnType<typeof createScreenPrefs>;

/**
 * A list that scrolls itself at the screen's speed while it overflows. It can
 * take focus, under its `label`, so a keyboard can scroll it too.
 */
function Scroller(props: { prefs: Prefs; label: string; class?: string; children: JSX.Element }) {
  let el: HTMLDivElement | undefined;
  onMount(() => {
    if (el) {
      onCleanup(autoScroll(el, () => PIXELS[props.prefs.speed()]));
    }
  });
  return (
    <div class={`tm-screen-scroll ${props.class ?? ''}`} ref={el} tabIndex={0} role='region' aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** A seat at a table: the name and record, the seed in a top cut, and once the table is done, how it went. */
function ScreenSeat(props: { name: string; record: string; seed?: number; mark: string }) {
  return (
    <span
      class='tm-screen-seat'
      classList={{ 'is-win': props.mark === 'W', 'is-out': props.mark === 'L', 'is-tie': props.mark === 'T' }}
    >
      <span class='tm-screen-name'>
        <Show when={props.seed}>{seed => <small class='num'>{seed()}</small>}</Show>
        <span class='tm-screen-name-text'>{props.name}</span>
      </span>
      <span class='tm-screen-record num'>{props.record}</span>
    </span>
  );
}

const MARK_WORDS: Record<string, string> = { W: msg('Won'), L: msg('Lost'), T: msg('Tie') };

/**
 * The middle of a table: its number, with any extra time it has while it
 * plays, and once it has a result, each seat's mark facing its player.
 */
function TableMiddle(props: { table: number; marks: [string, string]; extra?: number }) {
  return (
    <span class='tm-screen-mid'>
      <span class='tm-screen-table num'>{props.table || '—'}</span>
      <Show
        when={props.marks[0]}
        fallback={
          <small classList={{ 'tm-screen-extra': Boolean(props.extra) }}>
            {props.extra ? t('+{minutes} min', { minutes: props.extra / 60 }) : t('Table')}
          </small>
        }
      >
        <span class='tm-screen-score'>
          <For each={props.marks}>
            {mark => (
              <span class='tm-screen-mark' aria-label={t(MARK_WORDS[mark] ?? mark)}>
                {markText(mark)}
              </span>
            )}
          </For>
        </span>
      </Show>
    </span>
  );
}

/** A pod's tables in order, the players facing each other across the table number. */
function TableRows(props: { view: TournamentView; pod: Pod; round: Round; heading: boolean }) {
  const names = createMemo(() => namesById(props.view.tournament));
  // A division's top cut reads its records and seeds from the Swiss rounds that seeded it, among its own players.
  const played = createMemo(() => withSwiss(props.view.tournament, props.pod));
  const outcomeOf = (match: Match) => shownOutcome(match, props.pod, props.round, props.view.pending).outcome;
  const records = createMemo(() => recordsSoFar(played(), props.round, outcomeOf));
  const seeds = createMemo(() =>
    props.round.kind === 'elimination' ? cutSeeds(props.view.tournament, props.pod) : new Map<string, number>()
  );
  /** W, L or T by each seat once its table has a result; a bye or a missed round is not a table. */
  const marks = (match: Match): [string, string] => {
    if (match.p2 === null) {
      return ['', ''];
    }
    const outcome = outcomeOf(match);
    return [seatMark(outcome, 1), seatMark(outcome, 2)];
  };
  const seat = (id: string | null, mark: string, fallback: string) => (
    <ScreenSeat
      name={id ? (names().get(id) ?? id) : fallback}
      record={id ? (records().get(id) ?? '') : ''}
      seed={id ? seeds().get(id) : undefined}
      mark={mark}
    />
  );
  return (
    <section class='tm-screen-pod'>
      <Show when={props.heading}>
        <h2 class='tm-screen-pod-head'>{podLabel(props.pod)}</h2>
      </Show>
      <ol class='tm-screen-tables'>
        <For each={sortMatches(props.round.matches)}>
          {match => (
            <li classList={{ 'is-done': marks(match)[0] !== '' }}>
              {seat(match.p1, marks(match)[0], '')}
              <TableMiddle table={match.table} marks={marks(match)} extra={match.timeExtension?.seconds} />
              {seat(match.p2, marks(match)[1], match.outcome === 'bye' ? t('Bye') : t('Missed round'))}
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

/** Everyone registered and not dropped, by first name, for players to find themselves before round 1. */
function Registered(props: { view: TournamentView }) {
  const players = () =>
    props.view.tournament.players
      .filter(player => player.droppedAfter === null)
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
  return (
    <ol class='tm-screen-registered'>
      <For each={players()}>
        {player => (
          <li>
            <strong>{player.firstName}</strong> {player.lastName}
          </li>
        )}
      </For>
    </ol>
  );
}

const CutBracket = lazy(() => import('./Bracket').then(m => ({ default: m.CutBracket })));

/**
 * A pod's top cut as a bracket, under the pod's name when the screen shows
 * several; its tables when the cut cannot be drawn as one.
 */
function BracketRows(props: { view: TournamentView; pod: Pod; heading: boolean }) {
  const names = createMemo(() => namesById(props.view.tournament));
  return (
    <section class='tm-screen-pod'>
      <Show when={props.heading}>
        <h2 class='tm-screen-pod-head'>{podLabel(props.pod)}</h2>
      </Show>
      <CutBracket
        tournament={props.view.tournament}
        pod={props.pod}
        pending={props.view.pending}
        names={names()}
        class='is-screen'
        fallback={
          <TableRows view={props.view} pod={props.pod} round={latestRound(props.pod) as Round} heading={false} />
        }
      />
    </section>
  );
}

/** Every pod's current round, as tables or, for a top cut the screen is set to, a bracket. */
function Matches(props: { view: TournamentView; pods: Pod[]; prefs: Prefs }) {
  const asBracket = (pod: Pod) => props.prefs.view() === 'bracket' && hasCut(pod);
  return (
    // By position: a result changes its pod, and a pod drawn again from nothing would
    // send the room's scroll back to the top.
    <Index each={props.pods}>
      {pod => (
        <Show
          when={asBracket(pod())}
          fallback={
            <TableRows
              view={props.view}
              pod={pod()}
              round={latestRound(pod()) as Round}
              heading={props.pods.length > 1}
            />
          }
        >
          <BracketRows view={props.view} pod={pod()} heading={props.pods.length > 1} />
        </Show>
      )}
    </Index>
  );
}

/** Each pod's final standings, a table per division, under its name when there are several. */
function Standings(props: { view: TournamentView; pods: Pod[] }) {
  const names = createMemo(() => namesById(props.view.tournament));
  const divisionOf = (id: string) => props.view.divisions[id] ?? 'masters';
  const groups = createMemo(() =>
    props.pods.flatMap(pod =>
      podStandings(props.view.tournament, pod, divisionOf).map(group => ({
        heading: group.division ? divisionHeading(group.division) : podLabel(pod),
        rows: group.rows
      }))
    )
  );
  return (
    <For each={groups()}>
      {group => (
        <section class='tm-screen-pod'>
          <Show when={groups().length > 1}>
            <h2 class='tm-screen-pod-head'>{group.heading}</h2>
          </Show>
          <table class='tm-screen-standings num'>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('Player')}</th>
                <th>{t('Record')}</th>
                <th>{t('Points')}</th>
                <th>{t('Opp. win')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={group.rows}>
                {row => (
                  <tr>
                    <td class='tm-screen-place'>{row.place}</td>
                    <td class='tm-screen-player'>
                      {names().get(row.playerId) ?? row.playerId}
                      <Show when={props.view.decks[row.playerId]}>
                        {deck => (
                          <span class='tm-screen-deck'>
                            <DeckIcons label={deck()} size={32} />
                            <span class='tm-screen-deck-name'>{deck()}</span>
                          </span>
                        )}
                      </Show>
                    </td>
                    <td>{recordLabel(row.record)}</td>
                    <td class='tm-screen-points'>{row.points}</td>
                    <td>{percentLabel(row.owp)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      )}
    </For>
  );
}

/** The QR code to the event page, with the code and address for anyone who would rather type it. */
function Join(props: { url: string; large?: boolean; children?: JSX.Element }) {
  return (
    <div class='tm-screen-join' classList={{ 'is-large': props.large }}>
      <QrCode text={props.url} label={t('Event page QR code')} />
      <div>
        <p class='tm-screen-code num'>{props.url.split('/').pop()}</p>
        <p class='tm-screen-url'>{props.url.replace(/^https?:\/\//, '')}</p>
        {props.children}
      </div>
    </div>
  );
}

function Controls(props: {
  prefs: Prefs;
  shown: boolean;
  bracket: boolean;
  onFocus: () => void;
  /** While the screen has stopped hearing from the event: for the laptop, never for the room. */
  onRetry?: () => void;
}) {
  return (
    <div class='tm-screen-controls' classList={{ 'is-shown': props.shown }} onFocusIn={() => props.onFocus()}>
      <Show when={props.onRetry}>
        {retry => (
          <button type='button' class='btn btn-secondary' onClick={() => retry()()}>
            {t('Try again')}
          </button>
        )}
      </Show>
      <Show when={props.bracket}>
        <Segmented
          options={matchViews()}
          selected={props.prefs.view()}
          onSelect={value => props.prefs.setView(value)}
          ariaLabel={t('Show matches as')}
        />
      </Show>
      <span class='tm-screen-speed'>
        <strong>{t('Auto scroll')}</strong>
        <Segmented
          options={SPEEDS.map(speed => ({ ...speed, label: t(speed.label) }))}
          selected={props.prefs.speed()}
          onSelect={value => props.prefs.setSpeed(value)}
          ariaLabel={t('Auto scroll speed')}
        />
      </span>
    </div>
  );
}

/** What the screen shows under its header, for the phase the event is in. */
function PhaseBody(props: {
  phase: ScreenPhase;
  view: TournamentView;
  pods: Pod[];
  prefs: Prefs;
  url: string;
  label: string;
  display: DisplayOptions;
  font: number;
  size: { width: number; height: number };
}) {
  const firstRound = () => firstRoundTime(props.view.settings.startsAt);
  const tables = () => props.pods.reduce((count, pod) => count + (latestRound(pod)?.matches.length ?? 0), 0);
  const matches = () => (
    <Show
      when={pagedDisplay(props.display, tables(), props.size, props.font)}
      fallback={
        <Scroller prefs={props.prefs} label={t('Pairings')}>
          <Matches view={props.view} pods={props.pods} prefs={props.prefs} />
        </Scroller>
      }
    >
      <PagedDisplay
        view={props.view}
        pods={props.pods}
        options={props.display}
        font={props.font}
        still={props.prefs.speed() === 'off'}
      />
    </Show>
  );
  const views: Record<ScreenPhase, () => JSX.Element> = {
    roster: () => (
      <div class='tm-screen-before'>
        <Scroller prefs={props.prefs} label={t('Players')}>
          <Registered view={props.view} />
        </Scroller>
        <Join url={props.url} large>
          <Show when={firstRound()}>
            {time => <p class='tm-screen-first num'>{t('Round 1 at {time}', { time: time() })}</p>}
          </Show>
        </Join>
      </div>
    ),
    paired: matches,
    results: matches,
    clock: () => (
      <div class='tm-screen-timing'>
        <DivisionClocks pods={props.pods} pending={props.view.pending} label={props.label} />
        {matches()}
      </div>
    ),
    standings: () => (
      <Scroller prefs={props.prefs} label={t('Standings')}>
        <Standings view={props.view} pods={props.pods} />
      </Scroller>
    )
  };
  return <div class={`tm-screen-main is-${props.phase}`}>{views[props.phase]()}</div>;
}

export function BigScreen(props: { view: TournamentView; liveData?: LiveData; onRetry?: () => void }) {
  const prefs = createScreenPrefs();
  const [size, setSize] = createSignal({ width: window.innerWidth, height: window.innerHeight });
  const display = () => props.view.settings.display?.options ?? DEFAULT_DISPLAY;
  const font = () => displayFont(size(), display().scale);
  const now = createNow();
  const stale = useContext(StaleSince);
  const [controls, setControls] = createSignal(false);
  const url = () => `${location.origin}/t/${props.view.code}`;
  const pods = () => livePods(props.view.tournament).filter(pod => latestRound(pod));
  const anyBracket = createMemo(() => pods().some(hasCut));
  const phase = createMemo(() => screenPhase(pods(), props.view.pending, props.view.settings.finished));
  const status = () =>
    eventStatus(
      props.view.tournament,
      {
        pending: props.view.pending,
        finished: props.view.settings.finished,
        firstRound: firstRoundTime(props.view.settings.startsAt),
        roundCap: roundCapOf(props.view),
        // The division the room most likely asks about: the clock nearest its end (see clockOrder).
        prefer: [divisionClocks(pods(), props.view.pending, now())[0]?.pod.category]
      },
      stale()?.since ?? now()
    );
  // The clock's own words would repeat the clock under the header, and divisions on clocks of their own name themselves.
  const statusShown = () => {
    if (phase() !== 'clock') {
      return status();
    }
    return pods().length > 1 ? [] : status().slice(0, 2);
  };
  let hide: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    setControls(true);
    clearTimeout(hide);
    hide = setTimeout(() => setControls(false), CONTROLS_MS);
  };
  onMount(() => {
    document.body.classList.add('tm-screen-mode');
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    const wake = screenWakeLock(
      () => navigator.wakeLock.request('screen'),
      () => !document.hidden
    );
    const resume = () => void wake.resume();
    resume();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('resize', resize);
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's') {
        prefs.cycle();
        reveal();
      } else if (key === 'b' && anyBracket()) {
        prefs.toggleView();
        reveal();
      }
    };
    document.addEventListener('pointermove', reveal);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      clearTimeout(hide);
      wake.stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('resize', resize);
      document.removeEventListener('pointermove', reveal);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('tm-screen-mode');
    });
  });
  return (
    <div class='tm-screen' style={{ '--tm-display-scale': display().scale, '--tm-display-font': `${font()}px` }}>
      <header class='tm-screen-head'>
        <div class='tm-screen-text'>
          <h1 class='tm-screen-title'>{props.view.tournament.info.name}</h1>
          <Show when={statusShown().length > 0}>
            <p class='tm-screen-status'>
              <strong>{statusShown()[0]}</strong>
              <Show when={statusShown().length > 1}>
                <span class='muted'> · {statusShown().slice(1).join(' · ')}</span>
              </Show>
            </p>
          </Show>
          <LiveDataStatus data={props.liveData} />
        </div>
        <Show when={phase() !== 'roster'}>
          <Join url={url()} />
        </Show>
      </header>
      {/* Keyed by phase, so each layout rises in as the last gives way. */}
      <Show when={phase()} keyed>
        {current => (
          <PhaseBody
            phase={current}
            view={props.view}
            pods={pods()}
            prefs={prefs}
            url={url()}
            label={status()[0] ?? ''}
            display={display()}
            font={font()}
            size={size()}
          />
        )}
      </Show>
      <Controls
        prefs={prefs}
        shown={controls()}
        bracket={anyBracket()}
        onFocus={reveal}
        onRetry={stale() === null ? undefined : props.onRetry}
      />
    </div>
  );
}
