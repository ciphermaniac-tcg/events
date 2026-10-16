/**
 * Result entry where the room's rows are too narrow for their own controls
 * (900px and under, see RoundPanel): a table is pressed, and this sheet rises
 * with its players and every result it can take as full-size buttons. A
 * press records at once, since opening the sheet was the first step; a lone
 * report is offered as Accept among the actions, as in a wide row. The body
 * scrolls while the table and actions stay put. Focus starts on the sheet,
 * stays in it, and goes back to what opened it.
 */

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { Match, Outcome, Round } from '../../../shared/tournament/types';
import { msg, t } from '../../lib/i18n';
import { RESULT_WORDS } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';
import { OptionsMenu } from './OptionsMenu';
import { ExtensionClock } from './ExtensionClock';
import { inertOutside, keepTabIn } from '../../lib/focusTrap';

/** Table-level results, besides either player winning; an elimination match has neither. */
const EVEN: { outcome: Outcome; label: string }[] = [
  { outcome: 'tie', label: msg('Tie') },
  { outcome: 'double-loss', label: msg('Double loss') }
];

export function ResultSheet(props: {
  match: Match;
  round: Round;
  names: Map<string, string>;
  decks: Record<string, string>;
  records: Map<string, string>;
  /** The result that stands, or 'pending' while the table plays. */
  outcome: Outcome;
  /** What the players reported, as staff read it, while the table plays. */
  report: { label: string; detail: string } | null;
  /** A lone report staff can take as it is. */
  lone: Outcome | null;
  onPick: (outcome: Outcome) => void;
  onClose: () => void;
  onTimeExtension?: () => void;
}) {
  const [ready, setReady] = createSignal(false);
  let sheet: HTMLDivElement | undefined;
  let scrim: HTMLDivElement | undefined;
  const name = (id: string | null) => (id ? (props.names.get(id) ?? id) : '');
  // Full names: two players can share a first name, and the buttons must never read alike.
  const winners = (): { outcome: Outcome; label: string }[] => [
    { outcome: 'p1', label: t('{name} wins', { name: name(props.match.p1) }) },
    { outcome: 'p2', label: t('{name} wins', { name: name(props.match.p2) }) }
  ];
  const even = () => EVEN.map(choice => ({ ...choice, label: t(choice.label) }));
  const choices = () => [...winners(), ...(props.round.kind === 'elimination' ? [] : even())];
  const standing = () =>
    props.outcome === 'pending' ? (props.report?.label ?? t('In progress')) : t(RESULT_WORDS[props.outcome] ?? '');

  onMount(() => {
    // Back to whatever opened it once it closes; the page behind holds still meanwhile.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const { overflow } = root.style;
    root.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sheet?.querySelector('.tm-more > button[aria-expanded="true"]')) {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      } else if (sheet) {
        keepTabIn(sheet, event);
      }
    };
    document.addEventListener('keydown', key, true);
    // Only the sheet, and the scrim that closes it, can be reached while it is open.
    const live = sheet ? inertOutside(sheet, scrim ? [scrim] : []) : () => undefined;
    onCleanup(() => {
      document.removeEventListener('keydown', key, true);
      root.style.overflow = overflow;
      live();
      opener?.focus();
    });
    // The sheet itself takes focus, not its first button: a stray Enter must not record a result.
    sheet?.focus();
    requestAnimationFrame(() => setReady(true));
  });

  const seat = (id: string | null, seatOutcome: Outcome) => (
    <Show when={id}>
      {playerId => (
        <p
          class='tm-sheet-seat'
          classList={{ 'is-lost': props.outcome !== 'pending' && props.outcome !== seatOutcome }}
        >
          <DeckIcons label={props.decks[playerId()]} />
          <span class='tm-name'>{name(playerId())}</span>
          <span class='muted tm-record'>{props.records.get(playerId()) ?? ''}</span>
        </p>
      )}
    </Show>
  );

  return (
    <>
      <div ref={scrim} class='tm-result-scrim' onClick={() => props.onClose()} />
      <div
        ref={sheet}
        class='tm-result-sheet'
        classList={{ 'is-in': ready() }}
        role='dialog'
        aria-modal='true'
        tabIndex={-1}
        aria-label={t('Result, table {table}', { table: props.match.table })}
      >
        <div class='tm-sheet-top'>
          <strong>{t('Table {table}', { table: props.match.table })}</strong>
          <Show when={props.onTimeExtension}>
            <OptionsMenu name={t('table {table}', { table: props.match.table })} closeOnSelect>
              <button type='button' class='tm-menu-item' onClick={() => props.onTimeExtension?.()}>
                {t('Time extension')}
              </button>
            </OptionsMenu>
          </Show>
          <span
            class='tm-result-label'
            classList={{ 'is-open': props.outcome === 'pending' }}
            title={props.report?.detail}
          >
            {standing()}
          </span>
        </div>
        <div class='tm-result-sheet-body'>
          <div class='tm-sheet-seats'>
            <Show when={props.match.timeExtension}>
              <ExtensionClock match={props.match} round={props.round} playing={props.outcome === 'pending'} />
            </Show>
            {seat(props.match.p1, 'p1')}
            {seat(props.match.p2, 'p2')}
          </div>
          <div class='tm-sheet-choices'>
            <For each={choices()}>
              {choice => (
                <button
                  type='button'
                  class='btn btn-secondary'
                  aria-pressed={props.outcome === choice.outcome}
                  onClick={() => props.onPick(choice.outcome)}
                >
                  {choice.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class='tm-result-sheet-actions'>
          <Show when={props.lone}>
            {lone => (
              <button type='button' class='btn btn-primary tm-sheet-accept' onClick={() => props.onPick(lone())}>
                {t('Accept {result}', { result: t(RESULT_WORDS[lone()] ?? '') })}
              </button>
            )}
          </Show>
          <Show when={props.outcome !== 'pending'}>
            <button type='button' class='btn btn-ghost tm-sheet-clear' onClick={() => props.onPick('pending')}>
              {t('Clear result')}
            </button>
          </Show>
          <button type='button' class='btn btn-ghost tm-sheet-close' onClick={() => props.onClose()}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </>
  );
}
