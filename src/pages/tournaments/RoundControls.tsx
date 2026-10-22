/**
 * The controls that move a round along besides the next step (the console's
 * head offers that, see NextStep): the clock, re-pairing, deleting a round
 * nobody has played, and the champion. Each shows only in the state it belongs to, and anything that
 * cannot be taken back asks first, in place.
 */

import { Show } from 'solid-js';
import type { Pod, Round } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
import { clockTime } from '../../lib/tournament/clockState';
import { Clock } from './Clock';
import { ConfirmAction } from './ConfirmAction';
import type { ManageState } from './manageState';

/** The clock as one control: time left, then start or pause, then a minute either way. */
export function ClockControls(props: { state: ManageState; pod: Pod; round: Round; class?: string }) {
  const send = (type: 'startClock' | 'stopClock') => void props.state.send({ type, pod: props.pod.category });
  const adjust = (seconds: number) => void props.state.send({ type: 'adjustClock', pod: props.pod.category, seconds });
  const running = () => props.round.clockStartedAt != null;
  return (
    <span class={`tm-clock-group ${props.class ?? ''}`} role='group' aria-label={t('Round clock')}>
      <span class='tm-clock-face'>
        <Clock round={props.round} />
        <Show when={!running() && !props.round.startTime}>
          <span class='tm-clock num is-paused'>{clockTime(props.round.timeLeft)}</span>
        </Show>
      </span>
      <button type='button' onClick={() => send(running() ? 'stopClock' : 'startClock')}>
        {running() ? t('Pause') : props.round.startTime ? t('Resume') : t('Start clock')}
      </button>
      <button type='button' aria-label={t('Add a minute')} onClick={() => adjust(60)}>
        +1
      </button>
      <button type='button' aria-label={t('Take a minute off')} onClick={() => adjust(-60)}>
        −1
      </button>
    </span>
  );
}

/**
 * Re-pairing the open tables, asked in place. Only a round not yet started
 * can be re-paired (see repairable), so it has no results to keep or clear.
 * `names`: who the re-pair would seat.
 */
export function RepairControl(props: { state: ManageState; pod: Pod; label: string; names?: string; class?: string }) {
  return (
    <ConfirmAction
      class={props.class ?? 'btn btn-ghost tm-small'}
      label={props.label}
      question={
        props.names
          ? t('Re-pair the open tables to seat {names}?', { names: props.names })
          : t('Re-pair the open tables?')
      }
      confirmLabel={t('Re-pair')}
      disabled={props.state.busy()}
      onConfirm={() => void props.state.send({ type: 'repairRound', pod: props.pod.category, keepReported: true })}
    />
  );
}

/** Deleting a round nobody has reported a result in, asked in place. */
export function DeleteRound(props: { state: ManageState; pod: Pod; round: Round }) {
  return (
    <ConfirmAction
      class='btn btn-ghost tm-small'
      label={t('Delete round')}
      question={t('Delete round {number}?', { number: props.round.number })}
      confirmLabel={t('Delete')}
      danger
      disabled={props.state.busy()}
      onConfirm={() => void props.state.send({ type: 'deleteRound', pod: props.pod.category })}
    />
  );
}

/** Who won, one line per division's cut; ending the event is the console head's next step once there is a champion. */
export function ChampionLine(props: { name: string; label: string }) {
  return (
    <div class='tm-strip tm-champion' role='status'>
      <span class='tm-champion-label'>{props.label}</span>
      <strong class='tm-champion-name'>{props.name}</strong>
    </div>
  );
}
