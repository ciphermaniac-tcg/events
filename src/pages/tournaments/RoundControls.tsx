/**
 * The controls that move a round along besides the next step (the console's
 * head offers that, see NextStep): the clock, re-pairing, deleting a round
 * nobody has played, and the champion. Each shows only in the state it belongs to, and anything that
 * cannot be taken back asks first, in place.
 */

import { createSignal, createUniqueId, Show } from 'solid-js';
import type { Pod, Round } from '../../../shared/tournament/types';
import { t, tn } from '../../lib/i18n';
import { clockState, parseClock } from '../../lib/tournament/clockState';
import { Clock } from './Clock';
import { createNow } from './now';
import { ConfirmAction } from './ConfirmAction';
import type { ManageState } from './manageState';

/** A clock change in words, so a slip (50:00 for 05:00) shows before it is sent. */
function changeWords(seconds: number): string {
  if (seconds === 0) {
    return t('No change');
  }
  const minutes = Math.floor(Math.abs(seconds) / 60);
  const rest = Math.abs(seconds) % 60;
  const parts = [
    minutes ? tn(minutes, '{n} minute', '{n} minutes') : '',
    rest ? tn(rest, '{n} second', '{n} seconds') : ''
  ].filter(Boolean);
  return seconds > 0 ? t('Adds {time}', { time: parts.join(' ') }) : t('Takes off {time}', { time: parts.join(' ') });
}

/** Typing the time left: the field, the change it makes in words, Set and Cancel. */
function ClockSetter(props: { round: Round; onSet: (seconds: number) => void; onClose: () => void }) {
  const now = createNow();
  const left = () => clockState({ round: props.round, now: now(), set: true })?.left ?? 0;
  const [typed, setTyped] = createSignal('');
  const id = createUniqueId();
  const change = () => {
    const target = parseClock(typed());
    return target === null ? null : target - left();
  };
  return (
    <form
      class='tm-clock-setter'
      onSubmit={event => {
        event.preventDefault();
        const seconds = change();
        if (seconds !== null && seconds !== 0) {
          props.onSet(seconds);
        }
        props.onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          props.onClose();
        }
      }}
    >
      <label class='tm-label' for={`${id}-time`}>
        {t('Time left')}
      </label>
      <input
        id={`${id}-time`}
        ref={el => queueMicrotask(() => el.focus())}
        class='tm-input num'
        inputmode='numeric'
        autocomplete='off'
        placeholder='25:00'
        aria-describedby={`${id}-change`}
        value={typed()}
        onInput={event => setTyped(event.currentTarget.value)}
      />
      <span class='muted' id={`${id}-change`} aria-live='polite'>
        {change() === null ? (typed().trim() ? t('Type minutes, or m:ss.') : '') : changeWords(change()!)}
      </span>
      <span class='tm-clock-setter-acts'>
        <button type='submit' class='btn btn-secondary tm-small' disabled={change() === null}>
          {t('Set')}
        </button>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onClose()}>
          {t('Cancel')}
        </button>
      </span>
    </form>
  );
}

/** The clock as one control: time left (a press types a new one), then start or pause, then a minute either way. */
export function ClockControls(props: { state: ManageState; pod: Pod; round: Round; class?: string }) {
  const send = (type: 'startClock' | 'stopClock') => void props.state.send({ type, pod: props.pod.category });
  const adjust = (seconds: number) => void props.state.send({ type: 'adjustClock', pod: props.pod.category, seconds });
  const running = () => props.round.clockStartedAt != null;
  const [setting, setSetting] = createSignal(false);
  let face: HTMLButtonElement | undefined;
  const close = () => {
    setSetting(false);
    face?.focus();
  };
  return (
    <span class={`tm-clock-group ${props.class ?? ''}`} role='group' aria-label={t('Round clock')}>
      <button
        ref={face}
        type='button'
        class='tm-clock-face'
        aria-expanded={setting()}
        aria-label={t('Set the time left')}
        onClick={() => setSetting(open => !open)}
      >
        <Clock round={props.round} set />
      </button>
      {/* One unit, so a narrow screen moves the actions under the time together, never one alone. */}
      <span class='tm-clock-acts'>
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
      <Show when={setting()}>
        <ClockSetter round={props.round} onSet={adjust} onClose={close} />
      </Show>
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
