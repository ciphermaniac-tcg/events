import { createMemo, For, Show, useContext } from 'solid-js';
import type { Pod } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { msg, t, tn } from '../../lib/i18n';
import { clockState } from '../../lib/tournament/clockState';
import { Clock, StaleSince } from './Clock';
import { type DivisionClock, divisionClocks, onExtraTime } from './clockOrder';
import { checkedTime } from './LiveDataStatus';
import { createNow } from './now';

const WORDS: Partial<Record<DivisionClock['state'], string>> = {
  waiting: msg('Not started'),
  done: msg('Round complete')
};

function Time(props: { clock: DivisionClock; class: string }) {
  return (
    <Show when={WORDS[props.clock.state]} fallback={<Clock round={props.clock.round} class={props.class} face />}>
      {words => <span class={`${props.class} is-words`}>{t(words())}</span>}
    </Show>
  );
}

/** What a caption says after the clock's name: paused, or how long since time was called and who plays on. */
function notes(clock: DivisionClock, pending: readonly PendingResult[], now: number): string[] {
  const state = clock.state === 'done' ? null : clockState({ round: clock.round, now });
  if (!state) {
    return [];
  }
  if (state.left > 0) {
    return state.phase === 'paused' ? [t('Paused')] : [];
  }
  const extra = onExtraTime(clock, pending, now);
  return [
    t('Called {time} ago', { time: state.time }),
    ...(extra ? [tn(extra, '{n} table on extra time', '{n} tables on extra time')] : [])
  ];
}

/**
 * The words under a clock: its name and state. Under the leading clock, once
 * the screen stops hearing from the event, when it last did instead: every
 * clock has stopped there, and the room should not call time by it.
 */
function Caption(props: {
  clock: DivisionClock;
  pending: readonly PendingResult[];
  now: number;
  label?: string;
  lead?: boolean;
}) {
  const stale = useContext(StaleSince);
  const text = () => {
    const since = stale();
    if (props.lead && since !== null) {
      return t('Not updated since {time}', { time: checkedTime(since) });
    }
    return [props.label ?? props.clock.label, ...notes(props.clock, props.pending, since ?? props.now)].join(' · ');
  };
  return <p>{text()}</p>;
}

/**
 * The clock across the top of the screen. One division keeps the one large
 * clock over the round's status; more lead with the clock nearest its end,
 * each of the others smaller beside it, every one named for its division.
 */
export function DivisionClocks(props: { pods: Pod[]; pending: readonly PendingResult[]; label: string }) {
  const now = createNow();
  const clocks = createMemo(() => divisionClocks(props.pods, props.pending, now()), undefined, {
    // Ticking does not reorder the clocks unless the lead changes; the Clock itself ticks.
    equals: (a, b) =>
      a.length === b.length && a.every((clock, i) => clock.round === b[i]?.round && clock.state === b[i]?.state)
  });
  return (
    <Show
      when={clocks().length > 1}
      fallback={
        <div class='tm-screen-big-clock'>
          <Show when={clocks()[0]} fallback={<p>{props.label}</p>}>
            {clock => (
              <>
                <Time clock={clock()} class='tm-screen-clock' />
                <Caption clock={clock()} pending={props.pending} now={now()} label={props.label} lead />
              </>
            )}
          </Show>
        </div>
      }
    >
      <div class='tm-screen-big-clock is-divisions'>
        <div>
          <Time clock={clocks()[0] as DivisionClock} class='tm-screen-clock' />
          <Caption clock={clocks()[0] as DivisionClock} pending={props.pending} now={now()} lead />
        </div>
        <ul class='tm-screen-side-clocks'>
          <For each={clocks().slice(1)}>
            {clock => (
              <li>
                <Time clock={clock} class='tm-screen-side-clock' />
                <Caption clock={clock} pending={props.pending} now={now()} />
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}
