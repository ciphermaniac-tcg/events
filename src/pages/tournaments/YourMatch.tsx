/**
 * The viewer's own match on the public page, in two sizes. The strip says
 * where they sit and against whom, with the clock; where players report,
 * Report result opens it into the panel of answers. The button they pressed
 * is the state: accented once reported, marked when the opponent says
 * otherwise, and fixed once the result stands. A report can change until it
 * locks (see shared/tournament/reports.ts). Before round 1 the strip says
 * they are registered; once the event ends, where they placed.
 *
 * The viewer says who they are once (see Identify), and the device
 * remembers it; the page holds that (see PublicEvent). A signed-in account
 * that is the player is not asked: by its POP ID at a sanctioned event, or
 * by its Claim at an unsanctioned one, which it can undo from here. A
 * signed-out player is offered sign-in under the question.
 */

import { ordinal } from '../../lib/format';
import { msg, t, tn } from '../../lib/i18n';
import { createEffect, createSignal, For, Match, on, Show, Suspense, Switch } from 'solid-js';
import { lazyPanel } from './lazyPanel';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerResult } from '../../../shared/tournament/reports';
import { isBye, recordLabel, sideResult } from '../../../shared/tournament/standings';
import { hasStarted, podOf, withSwiss } from '../../../shared/tournament/rounds';
import type { Pod, Round, Match as TableMatch } from '../../../shared/tournament/types';
import { type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { ApiError, errorText, reportAsPlayer, type SignInOffer } from '../../lib/tournament/api';
import {
  currentMatchOf,
  divisionHeading,
  namesById,
  podStandings,
  recordsSoFar,
  reportState,
  shownOutcome
} from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { type Identified, IdentifyForm } from './Identify';
import { createNow } from './now';
import { PlayerRequests } from './PlayerRequests';
import { pendingSuggestion, SuggestedPlayer } from './SuggestedPlayer';

// Loaded on asking: most players never sign in from here, and Settings has these already.
const SignIn = lazyPanel(() => import('./SignIn').then(m => ({ default: m.SignIn })));

const SAID: Record<PlayerResult, string> = { win: msg('You won'), loss: msg('You lost'), tie: msg('You tied') };

const NOT_REPORTER = msg('Someone else is already reporting for this player. Ask staff if that’s wrong.');

const NOTES = {
  open: msg('Staff must accept your result.'),
  reported: msg('Waiting for staff acceptance.'),
  disputed: msg('Your reports don’t match. If you pressed the wrong one, change it. Otherwise, find a judge.'),
  /** Once the report is locked there is nothing to change: only the judge is left. */
  disputedLocked: msg('Your reports don’t match. Find a judge.')
};

interface Props {
  view: TournamentView;
  /** The viewer's player, once they have said who they are. */
  me: string | null;
  /** What they said, which reports carry; null until they say. */
  claim: PlayerClaim | null;
  /** The token of the device that reports for them, when this device is it. */
  reportToken: string | null;
  /** Whether they report from here: this device holds the token, or their account holds the seat. */
  reports: boolean;
  onIdentified: (found: Identified) => void;
  onForget: () => void;
  onView: (view: PublishedView) => void;
  onPlayer?: (id: string) => void;
  /** The start of round 1, formatted, or null when unset. */
  firstRound: string | null;
  /** Whether an account is signed in, which the page's copy of the event cannot say until the API answers. */
  signedIn: boolean;
  /** The sign-ins the server offers, for a player who is signed out. */
  offer: SignInOffer;
  /** Ends the signed-in account's Claim on the player, then forgets it on this device. */
  onUnlink: () => Promise<void>;
  /** Asks the server again who the viewer is: a report was refused, so who the page thinks they are may be out of date. */
  onStale: () => void;
}

interface Found {
  pod: Pod;
  round: Round;
  match: TableMatch;
}

/** Sign-in, asked for in place: a link until pressed, then the providers, coming back to the event. */
function SignInHere(props: { code: string; offer: SignInOffer }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show
      when={open()}
      fallback={
        <button type='button' class='tm-link-inline tm-you-signin' onClick={() => setOpen(true)}>
          {t('Sign in')}
        </button>
      }
    >
      <Suspense>
        <SignIn offer={props.offer} next={`/t/${props.code}`} />
      </Suspense>
    </Show>
  );
}

/**
 * Surname lookup is available independently of reporting permission or
 * account identity. A signed-in account that looks to be one of the players
 * is asked about them first (see SuggestedPlayer).
 */
function WhichPlayer(props: Props) {
  // Read again on each new copy of the event; No hides that player at once.
  const [declined, setDeclined] = createSignal<string | null>(null);
  const suggest = () => {
    const found = pendingSuggestion(props.view);
    return found?.key === declined() ? undefined : found;
  };
  return (
    <section class='tm-box tm-you tm-you-ask' aria-label={t('Your match')}>
      <Show
        when={suggest()}
        fallback={
          <>
            <h2 class='tm-you-q'>{t('Which player are you?')}</h2>
            <IdentifyForm
              view={props.view}
              idPrefix='lookup'
              submitLabel={t('Find my match')}
              lookup
              onFound={props.onIdentified}
            />
            <Show when={!props.signedIn}>
              <SignInHere code={props.view.code} offer={props.offer} />
            </Show>
          </>
        }
      >
        {found => (
          <SuggestedPlayer
            view={props.view}
            suggest={found()}
            onIdentified={props.onIdentified}
            onDeclined={() => setDeclined(found().key)}
          />
        )}
      </Show>
    </section>
  );
}

const CHOICES: { result: PlayerResult; label: string }[] = [
  { result: 'win', label: msg('I won') },
  { result: 'loss', label: msg('I lost') },
  { result: 'tie', label: msg('Tie') }
];

/** The viewer's report of their match: where it stands and sending it; staff accept it. */
function createReport(props: Props & { me: string }, found: () => Found | null) {
  const now = createNow();
  /** The answer on its way to the server: its button reads as pressed from the press, not from the reply. */
  const [sending, setSending] = createSignal<PlayerResult | null>(null);
  const busy = () => sending() !== null;
  const [error, setError] = createSignal<string | null>(null);
  const state = () => {
    const f = found();
    return props.claim && f && f.match.p2 !== null
      ? reportState(f, { pending: props.view.pending, reports: props.view.reports ?? [] }, props.me, now())
      : null;
  };

  async function send(result: PlayerResult) {
    const { claim } = props;
    const shown = found();
    if (!claim || !shown) {
      return;
    }
    const match = { pod: shown.pod.category, round: shown.round.number, table: shown.match.table };
    setSending(result);
    setError(null);
    try {
      props.onView((await reportAsPlayer(props.view.code, claim, { result, match }, props.reportToken)).view);
    } catch (err) {
      setError(errorText(err));
      // Not theirs to report (released, or linked elsewhere since), or the event moved on.
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
        props.onStale();
      }
    } finally {
      setSending(null);
    }
  }

  return { state, busy, sending, error, send };
}

type Report = ReturnType<typeof createReport>;

/** The answers, what the report is waiting on, and the line that explains it. */
function ReportPanel(props: { report: Report; found: Found }) {
  const s = () => props.report.state();
  const choices = () => (props.found.round.kind === 'elimination' ? CHOICES.filter(c => c.result !== 'tie') : CHOICES);
  const status = () => {
    const state = s();
    if (!state?.chosen) {
      return t('Not reported');
    }
    if (state.disputed) {
      return t('Reports don’t match');
    }
    return t('Waiting for staff');
  };
  const note = () => {
    const state = s();
    if (!state?.chosen) {
      return t(NOTES.open);
    }
    if (state.disputed) {
      return t(state.locked ? NOTES.disputedLocked : NOTES.disputed);
    }
    return t(NOTES.reported);
  };
  const fixed = () => Boolean(s()?.locked || s()?.final);
  return (
    <div class='tm-you-panel'>
      <div class='tm-you-answers'>
        <div class='tm-report-choices' role='group' aria-label={t('Report your result')}>
          <For each={choices()}>
            {choice => {
              const on = () => (props.report.sending() ?? s()?.chosen) === choice.result;
              return (
                <button
                  type='button'
                  class='btn'
                  classList={{
                    'btn-primary': on() && !s()?.disputed,
                    'btn-secondary': !on() || Boolean(s()?.disputed),
                    'is-disputed': on() && Boolean(s()?.disputed)
                  }}
                  aria-pressed={on()}
                  disabled={props.report.busy() || (fixed() && !on())}
                  aria-disabled={fixed() ? 'true' : undefined}
                  onClick={() => {
                    // The answer already filed: sending it again would only restart its window to change.
                    if (!fixed() && !on()) {
                      void props.report.send(choice.result);
                    }
                  }}
                >
                  {t(choice.label)}
                  <Show when={on() && s()?.disputed}>
                    <span class='sr-only'> {t('(your opponent reported otherwise)')}</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
        <strong class='tm-you-status' classList={{ 'is-bad': Boolean(s()?.disputed) }} role='status'>
          {status()}
        </strong>
      </div>
      <p class='tm-you-note muted'>{note()}</p>
      <ErrorLine message={props.report.error()} />
    </div>
  );
}

/** How the match went for the viewer, once it is decided; null while it is being played. */
function decided(report: Report, found: Found, me: string, view: TournamentView): PlayerResult | null {
  const state = report.state();
  if (state) {
    return state.final ? state.chosen : null;
  }
  const { outcome } = shownOutcome(found.match, found.pod, found.round, view.pending);
  return outcome === 'pending' ? null : sideResult(outcome, found.match.p1 === me ? 1 : 2);
}

function MatchLine(props: Props & { me: string; found: Found; report: Report; open: boolean; onOpen: () => void }) {
  const names = () => namesById(props.view.tournament);
  const opponent = () => (props.found.match.p1 === props.me ? props.found.match.p2 : props.found.match.p1);
  const result = () => decided(props.report, props.found, props.me, props.view);
  const canReport = () => props.view.settings.playerReporting && !props.open && (props.reports || !props.claim);
  return (
    <Show
      when={opponent()}
      fallback={
        <>
          <span class='tm-you-big'>{isBye(props.found.match.outcome) ? t('Bye') : t('Missed round')}</span>
          <span class='tm-you-mid muted'>{isBye(props.found.match.outcome) ? t('Counts as a win') : ''}</span>
          <span class='tm-you-end'>
            <Clock round={props.found.round} />
          </span>
        </>
      }
    >
      {id => (
        <>
          <span class='tm-you-big'>
            <small>{t('Table')}</small>
            <span class='num'>{props.found.match.table}</span>
          </span>
          <span class='tm-you-mid'>
            <span class='muted'>{t('vs')}</span>{' '}
            <button type='button' class='tm-seat-link' onClick={() => props.onPlayer?.(id())}>
              <span class='tm-name'>{names().get(id())}</span>
            </button>{' '}
            <span class='muted num'>
              {recordsSoFar(
                withSwiss(props.view.tournament, props.found.pod),
                props.found.round,
                match => shownOutcome(match, props.found.pod, props.found.round, props.view.pending).outcome
              ).get(id())}
            </span>
          </span>
          <span class='tm-you-end'>
            <Show
              when={result()}
              fallback={
                <>
                  <Clock round={props.found.round} extraSeconds={props.found.match.timeExtension?.seconds} />
                  <Show when={canReport()}>
                    <button type='button' class='btn btn-secondary tm-small' onClick={() => props.onOpen()}>
                      {t('Report result')}
                    </button>
                  </Show>
                </>
              }
            >
              {r => (
                <strong>
                  {props.report.state() ? `${t('Result stands')} · ` : ''}
                  {t(SAID[r()])}
                </strong>
              )}
            </Show>
          </span>
        </>
      )}
    </Show>
  );
}

/** Where the viewer finished: their place in their division, record and points. */
function placeOf(view: TournamentView, me: string) {
  const pod = podOf(view.tournament, me);
  if (!pod || pod.rounds.length === 0) {
    return null;
  }
  const divisionOf = (id: string) => view.divisions[id] ?? 'masters';
  const rows = podStandings(view.tournament, pod, divisionOf).flatMap(group => group.rows);
  return rows.find(row => row.playerId === me) ?? null;
}

function MatchBox(props: Props & { me: string; askAs: PlayerClaim | null }) {
  const [open, setOpen] = createSignal(false);
  const found = () => (props.view.settings.finished ? null : currentMatchOf(props.view.tournament, props.me));
  // A new round starts on Report result again, not on the last round's open answers.
  createEffect(
    on(
      () => {
        const f = found();
        return f ? `${f.pod.category}:${f.round.number}` : null;
      },
      () => setOpen(false),
      { defer: true }
    )
  );
  // Props go through whole: spreading them into an object would read them once and lose later updates.
  const report = createReport(props, found);
  const placed = () => (props.view.settings.finished ? placeOf(props.view, props.me) : null);
  const started = () => hasStarted(props.view.tournament);
  const panel = () => {
    const state = report.state();
    return props.reports && state && !state.final && (open() || state.disputed) ? state : null;
  };
  /** Another device reports for this player: this one follows the table and says why it cannot report. */
  const followsOnly = () => {
    const state = report.state();
    return !props.reports && state !== null && !state.final;
  };
  /** A looked-up player asked to report: the exact claim comes first. */
  const confirming = () => open() && !props.claim && found() !== null;
  const division = () => divisionHeading(props.view.divisions[props.me] ?? null);
  return (
    <section class='tm-box tm-you' aria-label={t('Your match')}>
      <div class='tm-you-top'>
        <Switch
          fallback={
            <>
              <span class='tm-you-big'>{started() ? t('Not paired') : t('Registered')}</span>
              <span class='tm-you-mid'>
                {!started() && props.firstRound ? t('Round 1 at {time}', { time: props.firstRound }) : ''}
              </span>
            </>
          }
        >
          <Match when={placed()}>
            {row => (
              <>
                <span class='tm-you-big'>
                  <small>{t('Place')}</small>
                  <span class='num'>{ordinal(row().place)}</span>
                </span>
                <span class='tm-you-mid num'>
                  {recordLabel(row().record)} · {tn(row().points, '{n} pt', '{n} pts')}
                </span>
              </>
            )}
          </Match>
          <Match when={found()}>
            {/* A dispute opens the panel on its own, so Report result goes whenever the panel shows. */}
            {f => (
              <MatchLine
                {...props}
                found={f()}
                report={report}
                open={Boolean(panel()) || confirming()}
                onOpen={() => setOpen(true)}
              />
            )}
          </Match>
        </Switch>
      </div>
      <Show when={followsOnly()}>
        <p class='tm-you-panel tm-you-note muted'>{t(NOT_REPORTER)}</p>
      </Show>
      <Show when={confirming()}>
        <div class='tm-you-panel'>
          <IdentifyForm
            view={props.view}
            idPrefix='report'
            submitLabel={t('Confirm reporting player')}
            expect={props.me}
            onFound={found => {
              setOpen(true);
              props.onIdentified(found);
            }}
          />
          <button type='button' class='btn btn-ghost' onClick={() => setOpen(false)}>
            {t('Cancel')}
          </button>
        </div>
      </Show>
      <Show when={panel() && found()}>{f => <ReportPanel report={report} found={f()} />}</Show>
      <Show when={!props.view.settings.finished && props.askAs}>
        {claim => (
          <PlayerRequests
            view={props.view}
            me={props.me}
            claim={claim()}
            reportToken={props.reportToken}
            onView={props.onView}
            onStale={props.onStale}
          />
        )}
      </Show>
      <WhoLine {...props} division={division()} />
    </section>
  );
}

/**
 * Who the box is for, and the way out when it is someone else's: forgetting
 * them on this device, or for an account's Claim, undoing it. An account
 * that is the player by its POP ID is that player wherever it signs in.
 */
function WhoLine(props: Props & { me: string; division: string }) {
  const [error, setError] = createSignal<string | null>(null);
  // How the signed-in account is this player, if it is: by its POP ID, or by its Claim.
  const via = () => (props.view.viewer.me === props.me ? props.view.viewer.via : null);
  async function unlink() {
    setError(null);
    try {
      await props.onUnlink();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <>
      <div class='tm-you-who'>
        <span class='muted'>
          {namesById(props.view.tournament).get(props.me)}
          {props.division ? ` · ${props.division}` : ''}
          {via() === 'claim' ? ` · ${t('Linked to your account')}` : ''}
        </span>
        <Switch
          fallback={
            <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onForget()}>
              {t('Not you?')}
            </button>
          }
        >
          <Match when={via() === 'pop'}>{null}</Match>
          <Match when={via() === 'claim'}>
            <ConfirmAction
              label={t('Not you?')}
              question={t('Unlink from your account?')}
              confirmLabel={t('Unlink')}
              danger
              onConfirm={() => void unlink()}
            />
          </Match>
        </Switch>
      </div>
      <ErrorLine message={error()} />
    </>
  );
}

/** The selected player's table, or read-only surname lookup until a player is selected. */
export function YourMatch(props: Props) {
  const reporting = () => props.view.settings.playerReporting;
  // Lookup is enough to show a table; reporting still needs a separate claim.
  const known = () => props.me !== null;
  return (
    <Switch>
      <Match when={!known()}>
        {/* A finished event has no match to find; its results are on the page. */}
        <Show when={!props.view.settings.finished}>
          <WhichPlayer {...props} />
        </Show>
      </Match>
      <Match when={props.me}>
        {/* Requests go from the device that holds the player's seat, reporting or not. */}
        {me => (
          <MatchBox
            {...props}
            me={me()}
            claim={reporting() ? props.claim : null}
            askAs={props.reports ? props.claim : null}
          />
        )}
      </Match>
    </Switch>
  );
}
