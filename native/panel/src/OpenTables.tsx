/**
 * The current round's tables still waiting on a result, from the file TOM
 * last saved. Each result button sends that table's slip code to TOM.
 */

import { createMemo, For, Show } from 'solid-js';
import { type MatchSlip, matchSlips, slipCode, type SlipOutcome } from '../../../shared/tournament/slipCodes';
import { playerName, POD_LABELS, type Tournament } from '../../../shared/tournament/types';
import type { Log } from './log';

const CHOICES: { outcome: SlipOutcome; label: string }[] = [
  { outcome: 'p1', label: 'Player 1' },
  { outcome: 'p2', label: 'Player 2' },
  { outcome: 'tie', label: 'Tie' }
];

function SlipRow(props: { slip: MatchSlip; pods: boolean; name: (id: string) => string; log: Log }) {
  const where = () =>
    `${props.pods ? `${POD_LABELS[props.slip.category]} ` : ''}round ${props.slip.round} table ${props.slip.table}`;
  const choices = () => CHOICES.map(choice => ({ ...choice, code: slipCode(props.slip, choice.outcome) }));
  return (
    <tr>
      <Show when={props.pods}>
        <td>{POD_LABELS[props.slip.category]}</td>
      </Show>
      <td class='tp-num'>{props.slip.table}</td>
      <td>{props.name(props.slip.p1)}</td>
      <td>{props.name(props.slip.p2)}</td>
      <td class='tp-acts'>
        <For each={choices()}>
          {choice => (
            <Show when={choice.code}>
              {code => (
                <button
                  type='button'
                  class='btn btn-secondary tp-small'
                  disabled={props.log.busy()}
                  onClick={() => void props.log.send([{ code: code(), what: `${where()}: ${choice.label}` }])}
                >
                  {choice.label}
                </button>
              )}
            </Show>
          )}
        </For>
      </td>
    </tr>
  );
}

export function OpenTables(props: { tournament: Tournament | null; log: Log }) {
  const open = createMemo(() =>
    props.tournament ? matchSlips(props.tournament).filter(slip => slip.outcome === 'pending') : []
  );
  const names = createMemo(() => new Map((props.tournament?.players ?? []).map(p => [p.id, playerName(p)])));
  const name = (id: string) => names().get(id) || id;
  const pods = () => new Set(open().map(slip => slip.category)).size > 1;
  const rounds = () => [...new Set(open().map(slip => slip.round))].join(', ');
  return (
    <section class='tp-section' aria-labelledby='tp-tables'>
      <h2 id='tp-tables'>Open tables</h2>
      <Show
        when={open().length > 0}
        fallback={<p class='tp-line muted'>{props.tournament ? 'No open tables' : 'Link a .tdf to see its tables'}</p>}
      >
        <p class='tp-line muted'>Round {rounds()}</p>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <Show when={pods()}>
                  <th scope='col'>Pod</th>
                </Show>
                <th scope='col'>Table</th>
                <th scope='col'>Player 1</th>
                <th scope='col'>Player 2</th>
                <th scope='col'>Result</th>
              </tr>
            </thead>
            <tbody>
              <For each={open()}>{slip => <SlipRow slip={slip} pods={pods()} name={name} log={props.log} />}</For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
