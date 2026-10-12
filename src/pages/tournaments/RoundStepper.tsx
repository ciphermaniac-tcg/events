/**
 * The round shown, as a picker between the rounds before and after it: the
 * console's round bar and the public page's pairings share it.
 */

import { For } from 'solid-js';
import type { Pod } from '../../../shared/tournament/types';
import { roundLabel } from '../../lib/tournament/present';

export function RoundPicker(props: { pod: Pod; selected: number; onSelect: (n: number) => void }) {
  return (
    <select class='tm-select' aria-label='Round' onChange={e => props.onSelect(Number(e.currentTarget.value))}>
      <For each={props.pod.rounds}>
        {round => (
          <option value={round.number} selected={round.number === props.selected}>
            {roundLabel(round, props.pod)}
          </option>
        )}
      </For>
    </select>
  );
}

/** The round before and after the one shown, either side of the picker. */
export function RoundStepper(props: { pod: Pod; selected: number; onSelect: (n: number) => void }) {
  const index = () => props.pod.rounds.findIndex(r => r.number === props.selected);
  const step = (by: number) => {
    const next = props.pod.rounds[index() + by];
    if (next) {
      props.onSelect(next.number);
    }
  };
  return (
    <span class='tm-stepper'>
      <button
        type='button'
        class='btn btn-secondary'
        aria-label='Previous round'
        disabled={index() <= 0}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <RoundPicker pod={props.pod} selected={props.selected} onSelect={props.onSelect} />
      <button
        type='button'
        class='btn btn-secondary'
        aria-label='Next round'
        disabled={index() >= props.pod.rounds.length - 1}
        onClick={() => step(1)}
      >
        ›
      </button>
    </span>
  );
}
