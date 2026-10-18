/**
 * The home page's phone: the sample event's public page as one player sees
 * it, with their table, the way to report, and the pairings. The card holds
 * one shape whether it asks for a result or says one, so nothing moves.
 */

import { For, Show } from 'solid-js';
import type { SampleTable } from '../../lib/tournament/sampleEvent';
import { t } from '../../lib/i18n';
import { SampleDeck } from './SampleDeck';
import { roundStatus } from './HomeScreen';
import { markOf, recordOf } from '../../lib/tournament/sampleSchedule';
import { SAMPLE_FOCUS, type SampleRun } from './sampleRun';

/** Tables the phone's list shows. */
const SHOWN = 3;

function said(table: SampleTable): string {
  if (table.winner === null) {
    return t('You tied');
  }
  return table.winner === SAMPLE_FOCUS ? t('You won') : t('You lost');
}

function YourMatch(props: { run: SampleRun }) {
  const at = () => props.run.tables().findIndex(table => table.p1 === SAMPLE_FOCUS || table.p2 === SAMPLE_FOCUS);
  const table = () => props.run.tables()[at()];
  const opponent = () => {
    const current = table();
    return current?.p1 === SAMPLE_FOCUS ? current.p2 : (current?.p1 ?? null);
  };
  return (
    <div class='tm-hp-you'>
      <div class='tm-hp-match'>
        <p class='tm-hp-table'>
          <small>{t('Table')}</small>
          <b class='num'>{at() + 1}</b>
          <span>
            {t('vs')} {opponent() ?? t('Bye')}
          </span>
          <em class='num'>{recordOf(props.run.standingOf(opponent() ?? SAMPLE_FOCUS)?.line)}</em>
        </p>
        <div class='tm-hp-act'>
          <Show
            when={table() && props.run.reported(at())}
            fallback={<span class='tm-hp-report'>{t('Report result')}</span>}
          >
            <b>{said(table() as SampleTable)}</b>
          </Show>
        </div>
      </div>
      <p class='tm-hp-who'>
        <span>
          <b>{SAMPLE_FOCUS}</b> · {t('Masters')}
        </span>
        <span>{t('Not you?')}</span>
      </p>
    </div>
  );
}

function Seat(props: { run: SampleRun; table: SampleTable; name: string | null; done: boolean }) {
  return (
    <span class='tm-hp-seat'>
      <b class='tm-hp-mark'>{markOf(props.table, props.name, props.done)}</b>
      <SampleDeck player={props.name} size={18} />
      <span class='tm-hp-name'>{props.name ?? t('Bye')}</span>
      <em class='num'>{props.name ? recordOf(props.run.standingOf(props.name)?.line) : ''}</em>
    </span>
  );
}

export function HomePhone(props: { run: SampleRun }) {
  return (
    <div class='tm-hp' role='img' aria-label={t('A player reporting from their phone')}>
      <div class='tm-hp-bar'>
        <span>
          Ciphermaniac <small>Events</small>
        </span>
        <span class='tm-hp-signin'>{t('Sign in')}</span>
      </div>
      <div class='tm-hp-body'>
        <p class='tm-hp-title'>Friday League</p>
        <p class='tm-hp-status'>
          {t('Round {n}', { n: props.run.round() })} · {roundStatus(props.run)}
        </p>
        <YourMatch run={props.run} />
        <div class='tm-hp-tabs'>
          <span class='is-on'>{t('Pairings')}</span>
          <span>{t('Standings')}</span>
          <span>{t('Decks')}</span>
        </div>
        <ol class='tm-hp-list'>
          <For each={props.run.tables().slice(0, SHOWN)}>
            {(table, i) => (
              <li>
                <span class='tm-hp-n num'>{i() + 1}</span>
                <span>
                  <Seat run={props.run} table={table} name={table.p1} done={props.run.reported(i())} />
                  <Seat run={props.run} table={table} name={table.p2} done={props.run.reported(i())} />
                </span>
              </li>
            )}
          </For>
        </ol>
      </div>
    </div>
  );
}
