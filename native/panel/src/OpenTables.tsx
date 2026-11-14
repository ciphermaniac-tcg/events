/**
 * The current round's tables still waiting on a result, from the file TOM
 * last saved. Each result button sends that table's slip code to TOM.
 */

import { createMemo, For, Show } from 'solid-js';
import { type MatchSlip, matchSlips, slipEntry, type SlipOutcome } from '../../../shared/tournament/slipCodes';
import { categoryCode } from '../../../shared/tournament/tdf';
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
  const choices = () => CHOICES.map(choice => ({ ...choice, entry: slipEntry(props.slip, choice.outcome) }));
  return (
    <tr>
      <Show when={props.pods}>
        <td>{POD_LABELS[props.slip.category]}</td>
      </Show>
      <td class='tp-num'>{props.slip.table}</td>
      <td>{props.name(props.slip.p1)}</td>
      <td>{props.name(props.slip.p2)}</td>
      <td>
        <span class='tp-acts tp-row-acts'>
          <For each={choices()}>
            {choice => (
              <Show when={choice.entry}>
                {entry => (
                  <button
                    type='button'
                    class='btn btn-secondary tp-small'
                    disabled={props.log.busy()}
                    onClick={() => void props.log.send([{ entry: entry(), what: `${where()}: ${choice.label}` }])}
                  >
                    {choice.label}
                  </button>
                )}
              </Show>
            )}
          </For>
        </span>
      </td>
    </tr>
  );
}

/** A Start round button for each pod's current round, so TOM takes its results. */
function StartRounds(props: { tournament: Tournament; log: Log }) {
  const pods = () => props.tournament.pods.filter(pod => pod.rounds.length > 0);
  return (
    <div class='tp-acts tp-starts'>
      <For each={pods()}>
        {pod => {
          const what = () =>
            `${pods().length > 1 ? `${POD_LABELS[pod.category]} ` : ''}round ${pod.rounds.at(-1)?.number ?? ''}`;
          return (
            <button
              type='button'
              class='btn btn-secondary'
              disabled={props.log.busy()}
              onClick={() => void props.log.startRound(Number(categoryCode(pod.category)), `Start ${what()}`)}
            >
              Start {what()}
            </button>
          );
        }}
      </For>
    </div>
  );
}

export function OpenTables(props: { tournament: Tournament | null; log: Log }) {
  const open = createMemo(() =>
    props.tournament ? matchSlips(props.tournament).filter(slip => slip.outcome === 'pending') : []
  );
  const names = createMemo(() => new Map((props.tournament?.players ?? []).map(p => [p.id, playerName(p)])));
  const name = (id: string) => names().get(id) || id;
  const pods = () => new Set(open().map(slip => slip.category)).size > 1;
  return (
    <section class='tp-section' aria-labelledby='tp-tables'>
      <h2 id='tp-tables'>Open tables</h2>
      <Show when={props.tournament}>{tournament => <StartRounds tournament={tournament()} log={props.log} />}</Show>
      <Show
        when={open().length > 0}
        fallback={<p class='tp-line muted'>{props.tournament ? 'No open tables' : 'Link a .tdf to see its tables'}</p>}
      >
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
