import { type Accessor, createContext, Show, useContext } from 'solid-js';
import type { Round } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
import { clockWords } from '../../lib/tournament/present';
import { type ClockState, clockState } from '../../lib/tournament/clockState';
import type { Stale } from '../../lib/tournament/liveData';
import { createNow } from './now';

/**
 * Where the page stands while what it has is stale; null while fresh. A page
 * that keeps up with the event provides it, and every clock in it stops at
 * the moment the page fell behind.
 */
export const StaleSince = createContext<Accessor<Stale | null>>(() => null);

/**
 * The time a page's clocks and status lines read: now, ticking, or once the
 * page has fallen behind the event, the moment it did, so nothing beside a
 * stopped clock keeps counting.
 */
export function createClockNow(): Accessor<number> {
  const now = createNow();
  const stale = useContext(StaleSince);
  return () => stale()?.since ?? now();
}

/** The face across a room: the time, or once there is none left, the word. Its caption says the rest. */
const clockFace = (state: ClockState) => (state.left <= 0 ? t('Time') : state.time);

/**
 * A round's time left, or with `extraSeconds` a table's, ticking while the
 * clock runs; nothing once `done`, or before the clock first starts unless
 * `set`, where staff start it. `face` draws it for the big screen, whose
 * caption carries the words.
 */
export function Clock(props: {
  round: Round;
  class?: string;
  extraSeconds?: number;
  done?: boolean;
  set?: boolean;
  label?: string;
  face?: boolean;
}) {
  const now = createNow();
  const staleSince = useContext(StaleSince);
  const state = () =>
    clockState({
      round: props.round,
      now: now(),
      extraSeconds: props.extraSeconds,
      done: props.done,
      staleSince: staleSince()?.since,
      set: props.set
    });
  const shown = () => {
    const current = state();
    return current?.phase === 'done' ? null : current;
  };
  return (
    <Show when={shown()}>
      {current => (
        <span
          class={`tm-clock num ${props.class ?? ''}`}
          classList={{
            'is-paused': current().phase === 'paused' || current().phase === 'set',
            'is-over': current().left <= 0,
            'is-stale': current().phase === 'stale'
          }}
          role='timer'
          aria-label={props.label ?? (props.extraSeconds ? t('Time left at your table') : t('Time left in the round'))}
        >
          {props.face ? clockFace(current()) : clockWords(current())}
        </span>
      )}
    </Show>
  );
}
