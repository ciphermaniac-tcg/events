import { Show } from 'solid-js';
import type { Round } from '../../../shared/tournament/types';
import { clockLabel } from '../../lib/tournament/present';
import { createNow } from './now';

/** The round's time left, ticking while the clock runs. */
export function Clock(props: { round: Round; class?: string; extraSeconds?: number }) {
  const now = createNow();
  const running = () => props.round.clockStartedAt != null;
  return (
    <Show when={running() || props.round.startTime}>
      <span
        class={`tm-clock num ${props.class ?? ''}`}
        classList={{
          'is-paused': !running(),
          'is-over': clockLabel(props.round, now(), props.extraSeconds).startsWith('-')
        }}
        role='timer'
        aria-label={props.extraSeconds ? 'Time left at your table' : 'Time left in the round'}
      >
        {clockLabel(props.round, now(), props.extraSeconds)}
      </span>
    </Show>
  );
}
