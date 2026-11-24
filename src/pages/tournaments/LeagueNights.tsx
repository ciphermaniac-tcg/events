/**
 * Editing a store's league nights, on the store application and in store
 * settings: each weekly night as one row of its day, start, the event name
 * it is listed under (the store's own when blank) and fee, in the currency of
 * the store's country,
 * and (settings only) the dates a night does not run as usual, each off or
 * moved to another time. Rows change in place; the page saves the list.
 */

import { For, Index, type JSX, Show } from 'solid-js';
import { type LeagueNight, type NightException, STORE_LIMITS } from '../../../shared/accounts/stores';
import { currencySymbol } from '../../lib/events/format';
import { t, tc } from '../../lib/i18n';
import {
  blankNight,
  clock,
  feeAmount,
  feeOf,
  movedFrom,
  oneNightADay,
  WEEKDAY_INDEXES,
  weekdayName
} from '../../lib/tournament/stores';
import '../../styles/pages/tournament-store-forms.css';

const replaceAt = <T,>(list: readonly T[], index: number, item: T) => list.map((old, i) => (i === index ? item : old));
const removeAt = <T,>(list: readonly T[], index: number) => list.filter((_, i) => i !== index);

/**
 * One field of a row under its name: the column heads say it on a wide
 * screen, the label over the field on a phone. The field keeps its own
 * label for a screen reader, so the words drawn are only for the eye.
 */
function Cell(props: { label: string; wide?: boolean; children: JSX.Element }) {
  return (
    <span class='tm-night-cell' classList={{ 'is-wide': props.wide === true }}>
      <span class='tm-night-label' aria-hidden='true'>
        {props.label}
      </span>
      {props.children}
    </span>
  );
}

/** The column heads over a list of rows, for a wide screen. */
function Heads(props: { labels: string[]; class?: string }) {
  return (
    <li class={`tm-night tm-night-heads ${props.class ?? ''}`} aria-hidden='true'>
      <For each={props.labels}>{label => <span>{label}</span>}</For>
      {/* Remove's own width, unseen, so the heads take the rows' columns. */}
      <span class='tm-night-gap'>{t('Remove')}</span>
    </li>
  );
}

/** The fee, behind its currency's symbol when the store's country has one. */
function FeeInput(props: { fee: string; symbol: string | null; label: string; onChange: (fee: string) => void }) {
  return (
    <span class='tm-night-fee'>
      <Show when={props.symbol}>
        {symbol => (
          <span class='tm-fee-symbol' aria-hidden='true'>
            {symbol()}
          </span>
        )}
      </Show>
      <input
        class='tm-input'
        style={props.symbol ? { 'padding-left': `calc(14px + ${props.symbol.length}ch)` } : undefined}
        aria-label={props.label}
        inputMode='decimal'
        placeholder={props.symbol ? '0' : t('Fee')}
        maxLength={STORE_LIMITS.fee - (props.symbol?.length ?? 0)}
        value={feeAmount(props.fee, props.symbol)}
        onInput={e => props.onChange(feeOf(e.currentTarget.value, props.symbol))}
      />
    </span>
  );
}

function NightRow(props: {
  night: LeagueNight;
  n: number;
  symbol: string | null;
  storeName: string;
  /** The form tried to send, so a night with no start time is marked. */
  checked?: boolean;
  onChange: (night: LeagueNight) => void;
  onRemove: () => void;
}) {
  const n = () => ({ n: props.n });
  const set = (change: Partial<LeagueNight>) => props.onChange({ ...props.night, ...change });
  return (
    <li class='tm-night'>
      <Cell label={t('Day')}>
        <select
          class='tm-select'
          aria-label={t('League night {n} day', n())}
          value={props.night.weekday}
          onChange={e => set({ weekday: Number(e.currentTarget.value) })}
        >
          <For each={WEEKDAY_INDEXES}>{day => <option value={day}>{weekdayName(day)}</option>}</For>
        </select>
      </Cell>
      <Cell label={t('Start')}>
        <input
          class='tm-input tm-night-time'
          type='time'
          required
          aria-label={t('League night {n} start', n())}
          aria-invalid={props.checked && !props.night.time ? 'true' : undefined}
          value={props.night.time}
          onInput={e => set({ time: e.currentTarget.value })}
        />
      </Cell>
      <Cell label={t('Event name')} wide>
        <input
          class='tm-input'
          aria-label={t('League night {n} event name', n())}
          placeholder={props.storeName.trim() || t('Event name')}
          maxLength={STORE_LIMITS.nightName}
          value={props.night.name}
          onInput={e => set({ name: e.currentTarget.value })}
        />
      </Cell>
      <Cell label={t('Fee')}>
        <FeeInput
          fee={props.night.fee}
          symbol={props.symbol}
          label={t('League night {n} fee', n())}
          onChange={fee => set({ fee })}
        />
      </Cell>
      <button
        type='button'
        class='btn btn-ghost tm-small'
        aria-label={t('League night {n} remove', n())}
        onClick={() => props.onRemove()}
      >
        {t('Remove')}
      </button>
    </li>
  );
}

/**
 * The weekly nights, in the order they were added, with a way to add one;
 * fees in the currency of the store's `country`, and nights with no event
 * name listed under `storeName`.
 */
export function WeeklyNights(props: {
  nights: readonly LeagueNight[];
  country: string;
  storeName: string;
  checked?: boolean;
  onChange: (nights: LeagueNight[]) => void;
}) {
  const symbol = () => currencySymbol(props.country);
  return (
    <div class='tm-nights'>
      <Show when={props.nights.length > 0}>
        <ul class='tm-night-list'>
          <Heads labels={[t('Day'), t('Start'), t('Event name'), t('Fee')]} />
          {/* By position, not by object: each edit makes a new night, and its row must keep the focus. */}
          <Index each={props.nights}>
            {(night, i) => (
              <NightRow
                night={night()}
                n={i + 1}
                symbol={symbol()}
                storeName={props.storeName}
                checked={props.checked}
                onChange={next => props.onChange(replaceAt(props.nights, i, next))}
                onRemove={() => props.onChange(removeAt(props.nights, i))}
              />
            )}
          </Index>
        </ul>
      </Show>
      <Show when={props.nights.length < STORE_LIMITS.nights}>
        <button
          type='button'
          class='btn btn-secondary tm-small tm-night-add'
          onClick={() => props.onChange([...props.nights, blankNight(props.nights)])}
        >
          {t('Add a league night')}
        </button>
      </Show>
    </div>
  );
}

const nightLabel = (night: LeagueNight) =>
  `${weekdayName(night.weekday)} ${clock(night.time)}${night.name ? ` · ${night.name}` : ''}`;

function ExceptionRow(props: {
  exception: NightException;
  nights: readonly LeagueNight[];
  n: number;
  /** The store's today: a date before it is dropped as the list saves, so the row says so. */
  today: string;
  onChange: (exception: NightException) => void;
  onRemove: () => void;
}) {
  const n = () => ({ n: props.n });
  const set = (change: Partial<NightException>) => props.onChange({ ...props.exception, ...change });
  const past = () => props.exception.date !== '' && props.exception.date < props.today;
  return (
    <li class='tm-night tm-night-exception' classList={{ 'is-picked': !oneNightADay(props.nights) }}>
      <Cell label={t('Date')}>
        <input
          class='tm-input tm-night-date'
          type='date'
          required
          min={props.today}
          aria-label={t('Date {n} day', n())}
          aria-invalid={past() ? 'true' : undefined}
          aria-describedby={past() ? `night-date-${props.n}-past` : undefined}
          value={props.exception.date}
          onInput={e => set({ date: e.currentTarget.value })}
        />
      </Cell>
      {/* With one night a weekday, the date says which night it is. */}
      <Show when={!oneNightADay(props.nights)}>
        <Cell label={t('Night')}>
          <select
            class='tm-select'
            aria-label={t('Date {n} night', n())}
            value={props.exception.nightId ?? ''}
            onChange={e => set({ nightId: e.currentTarget.value || null })}
          >
            <option value=''>{t('Every night that day')}</option>
            <For each={props.nights}>{item => <option value={item.id}>{nightLabel(item)}</option>}</For>
          </select>
        </Cell>
      </Show>
      <Cell label={tc('league night', 'Change')}>
        <span class='tm-night-change'>
          <select
            class='tm-select'
            aria-label={t('Date {n} change', n())}
            value={props.exception.time === null ? 'off' : 'moved'}
            onChange={e =>
              set({ time: e.currentTarget.value === 'off' ? null : movedFrom(props.exception, props.nights) })
            }
          >
            <option value='off'>{tc('league night', 'Off')}</option>
            <option value='moved'>{t('Moved to')}</option>
          </select>
          <Show when={props.exception.time !== null}>
            <input
              class='tm-input tm-night-time'
              type='time'
              required
              aria-label={t('Date {n} new start', n())}
              value={props.exception.time ?? ''}
              onInput={e => set({ time: e.currentTarget.value })}
            />
          </Show>
        </span>
      </Cell>
      <Cell label={t('Note')} wide>
        <input
          class='tm-input'
          aria-label={t('Date {n} note', n())}
          maxLength={STORE_LIMITS.note}
          value={props.exception.note}
          onInput={e => set({ note: e.currentTarget.value })}
        />
      </Cell>
      <button
        type='button'
        class='btn btn-ghost tm-small'
        aria-label={t('Date {n} remove', n())}
        onClick={() => props.onRemove()}
      >
        {t('Remove')}
      </button>
      <Show when={past()}>
        <span class='tm-error' id={`night-date-${props.n}-past`}>
          {t('That date has passed. Pick today or a later date.')}
        </span>
      </Show>
    </li>
  );
}

/** The dates a night is off or moved; a new one starts on `today`, off. */
export function NightExceptions(props: {
  exceptions: readonly NightException[];
  nights: readonly LeagueNight[];
  today: string;
  onChange: (exceptions: NightException[]) => void;
}) {
  const picked = () => !oneNightADay(props.nights);
  return (
    <div class='tm-nights'>
      <Show when={props.exceptions.length > 0}>
        <ul class='tm-night-list'>
          <Heads
            labels={[t('Date'), ...(picked() ? [t('Night')] : []), tc('league night', 'Change'), t('Note')]}
            class={picked() ? 'tm-night-exception is-picked' : 'tm-night-exception'}
          />
          <Index each={props.exceptions}>
            {(exception, i) => (
              <ExceptionRow
                exception={exception()}
                nights={props.nights}
                n={i + 1}
                today={props.today}
                onChange={next => props.onChange(replaceAt(props.exceptions, i, next))}
                onRemove={() => props.onChange(removeAt(props.exceptions, i))}
              />
            )}
          </Index>
        </ul>
      </Show>
      <Show when={props.exceptions.length < STORE_LIMITS.exceptions}>
        <button
          type='button'
          class='btn btn-secondary tm-small tm-night-add'
          onClick={() =>
            props.onChange([...props.exceptions, { date: props.today, nightId: null, time: null, note: '' }])
          }
        >
          {t('Add a date')}
        </button>
      </Show>
    </div>
  );
}
