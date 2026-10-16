import { createMemo, For, Show } from 'solid-js';
import type { Pod } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { msg, t } from '../../lib/i18n';
import { Clock } from './Clock';
import { type DivisionClock, divisionClocks } from './clockOrder';
import { createNow } from './now';

const WORDS: Partial<Record<DivisionClock['state'], string>> = {
  waiting: msg('Not started'),
  done: msg('Round complete')
};

function Time(props: { clock: DivisionClock; class: string }) {
  return (
    <Show when={WORDS[props.clock.state]} fallback={<Clock round={props.clock.round} class={props.class} />}>
      {words => <span class={`${props.class} is-words`}>{t(words())}</span>}
    </Show>
  );
}

const named = (clock: DivisionClock, label = clock.label) =>
  clock.state === 'paused' ? t('{label} · Paused', { label }) : label;

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
                <p>{named(clock(), props.label)}</p>
              </>
            )}
          </Show>
        </div>
      }
    >
      <div class='tm-screen-big-clock is-divisions'>
        <div>
          <Time clock={clocks()[0] as DivisionClock} class='tm-screen-clock' />
          <p>{named(clocks()[0] as DivisionClock)}</p>
        </div>
        <ul class='tm-screen-side-clocks'>
          <For each={clocks().slice(1)}>
            {clock => (
              <li>
                <Time clock={clock} class='tm-screen-side-clock' />
                <p>{named(clock)}</p>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}
