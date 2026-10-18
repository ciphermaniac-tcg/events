/**
 * The home page's big screen: the sample round's pairings as a room's TV
 * shows them (BigScreen), with the join code and its QR code. Each table
 * keeps a line for its result, so a result coming in moves nothing.
 */

import { For } from 'solid-js';
import { SAMPLE_CODE, SAMPLE_QR } from '../../lib/tournament/sampleEvent';
import { t, tn } from '../../lib/i18n';
import { QrCode } from './QrCode';
import { markOf, recordOf } from '../../lib/tournament/sampleSchedule';
import { SAMPLE_ROUNDS, type SampleRun } from './sampleRun';

/** Tables the preview shows. */
const SHOWN = 6;

function Seat(props: { run: SampleRun; name: string | null; out: boolean; win: boolean }) {
  return (
    <div class='tm-hs-seat' classList={{ 'is-out': props.out, 'is-win': props.win }}>
      <span class='tm-hs-name'>{props.name ?? t('Bye')}</span>
      <span class='tm-hs-record num'>{props.name ? recordOf(props.run.standingOf(props.name)?.line) : ''}</span>
    </div>
  );
}

/** "Round 2 of 5 · 6 tables playing", or that every result is in. */
export function roundStatus(run: SampleRun): string {
  const playing = run.tables().length - run.reportedCount();
  return playing > 0
    ? tn(playing, '{n} table playing', '{n} tables playing')
    : tn(run.tables().length, 'all {n} table in', 'all {n} tables in');
}

export function HomeScreen(props: { run: SampleRun }) {
  const shown = () => props.run.tables().slice(0, SHOWN);
  return (
    <div class='tm-hs' role='img' aria-label={t('A sample event on the big screen')}>
      <div class='tm-hs-head'>
        <div>
          <p class='tm-hs-title'>Friday League</p>
          <p class='tm-hs-status'>
            <b>{t('Round {n} of {total}', { n: props.run.round(), total: SAMPLE_ROUNDS })}</b> ·{' '}
            {roundStatus(props.run)}
          </p>
        </div>
        <div class='tm-hs-join'>
          <QrCode text={SAMPLE_QR} label={t('QR code to the event')} />
          <div>
            <b class='tm-hs-code'>{SAMPLE_CODE}</b>
            <span class='tm-hs-url'>events.ciphermaniac.com/t/{SAMPLE_CODE}</span>
          </div>
        </div>
      </div>
      <ol class='tm-hs-tables'>
        <For each={shown()}>
          {(table, i) => {
            const done = () => props.run.reported(i());
            const out = (name: string | null) => done() && table.winner !== null && table.winner !== name;
            return (
              <li classList={{ 'is-done': done() }}>
                <Seat run={props.run} name={table.p1} out={out(table.p1)} win={done() && table.winner === table.p1} />
                <span class='tm-hs-mid'>
                  <span class='tm-hs-table num'>{i() + 1}</span>
                  <span class='tm-hs-score'>
                    {done() ? `${markOf(table, table.p1, true)}–${markOf(table, table.p2, true)}` : ' '}
                  </span>
                </span>
                <Seat run={props.run} name={table.p2} out={out(table.p2)} win={done() && table.winner === table.p2} />
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
}
