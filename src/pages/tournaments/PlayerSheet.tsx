/**
 * One player's event, opened from any name on the public page: where they
 * stand, record, points and tiebreakers, then every round with the opponent,
 * the opponent's record and the result. A side sheet on desktop, a bottom
 * sheet on a phone. It is also where a player marks themselves, proving it
 * with their Player ID or last name, so the page can lead with their table
 * from then on, and where a spectator follows them. A viewer the page
 * already knows as a player is not offered to be another.
 */

import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { percentLabel, recordLabel, type Standing } from '../../../shared/tournament/standings';
import type { Pod } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { inertOutside, keepTabIn } from '../../lib/focusTrap';
import { matchHistory } from '../../lib/tournament/present';
import { t } from '../../lib/i18n';
import { DeckIcons } from './DeckIcons';
import { type Identified, IdentifyForm } from './Identify';
import { Squares } from './Squares';

export function PlayerSheet(props: {
  view: TournamentView;
  playerId: string;
  pod: Pod;
  standing: Standing | undefined;
  /** Where they stand, as "2nd in Masters". */
  place: string;
  names: Map<string, string>;
  /** Each player's record so far. */
  records: Map<string, string>;
  decks: Record<string, string>;
  /** The viewer's own player, once the page knows them. */
  me: string | null;
  /** Whether this device follows the player, for the pairings' Following filter. */
  following: boolean;
  onFollow: () => void;
  onIdentified: (found: Identified) => void;
  onForget: () => void;
  onClose: () => void;
  onPlayer: (id: string) => void;
}) {
  const history = () => matchHistory(props.pod, props.playerId);
  const [proving, setProving] = createSignal(false);
  // Opening another player's sheet starts over rather than asking for them.
  createEffect(
    on(
      () => props.playerId,
      () => setProving(false),
      { defer: true }
    )
  );
  // Focus goes into the sheet, stays there, and goes back to what opened it; Escape closes it.
  const opener = document.activeElement as HTMLElement | null;
  let sheet: HTMLDivElement | undefined;
  let scrim: HTMLDivElement | undefined;
  // Only the sheet, and the scrim that closes it, can be reached while it is open.
  let live: () => void = () => undefined;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      props.onClose();
    } else if (sheet) {
      keepTabIn(sheet, event);
    }
  };
  // The page behind holds still while the sheet is open.
  const { overflow } = document.documentElement.style;
  onMount(() => {
    document.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    if (sheet) {
      live = inertOutside(sheet, scrim ? [scrim] : []);
    }
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.overflow = overflow;
    live();
    opener?.focus();
  });
  return (
    <>
      <div ref={scrim} class='tm-scrim' aria-hidden='true' onClick={() => props.onClose()} />
      <div ref={sheet} class='tm-sheet' role='dialog' aria-modal='true' aria-labelledby='tm-sheet-title'>
        <div class='tm-sheet-head'>
          <div>
            <h2 id='tm-sheet-title'>
              <DeckIcons label={props.decks[props.playerId]} size={22} />
              {props.names.get(props.playerId)}
            </h2>
            <p class='muted'>
              {props.place}
              <Show when={props.decks[props.playerId]}>{label => <> · {label()}</>}</Show>
            </p>
          </div>
          <button
            type='button'
            class='btn btn-ghost'
            ref={el => queueMicrotask(() => el.focus())}
            onClick={() => props.onClose()}
          >
            {t('Close')}
          </button>
        </div>
        <div class='tm-sheet-body'>
          <Show when={props.standing}>
            {row => (
              <dl class='tm-sheet-stats'>
                <div>
                  <dd class='num'>{recordLabel(row().record)}</dd>
                  <dt>{t('Record')}</dt>
                </div>
                <div>
                  <dd class='num'>{row().points}</dd>
                  <dt>{t('Points')}</dt>
                </div>
                <div>
                  <dd class='num'>{percentLabel(row().owp)}</dd>
                  <dt>OWP</dt>
                </div>
                <div>
                  <dd class='num'>{percentLabel(row().oowp)}</dd>
                  <dt>OOWP</dt>
                </div>
              </dl>
            )}
          </Show>
          <div class='tm-box'>
            <table class='data tm-history'>
              <thead>
                <tr>
                  <th class='num tm-table-col'>{t('Round')}</th>
                  <th>{t('Opponent')}</th>
                  <th class='num'>{t('Result')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={history()}>
                  {row => (
                    <tr>
                      <td class='num muted-cell tm-table-col'>{row.round}</td>
                      <td>
                        <Show
                          when={row.opponent}
                          fallback={<span class='muted'>{row.outcome === 'bye' ? t('Bye') : t('Missed round')}</span>}
                        >
                          {opponent => (
                            <button type='button' class='tm-seat-link' onClick={() => props.onPlayer(opponent())}>
                              <DeckIcons label={props.decks[opponent()]} />
                              <span class='tm-name'>{props.names.get(opponent())}</span>
                              <span class='muted-cell tm-record'>{props.records.get(opponent()) ?? ''}</span>
                            </button>
                          )}
                        </Show>
                      </td>
                      <td class='num'>
                        <Show
                          when={row.mark}
                          fallback={<span class='muted-cell'>{t('Table {table}', { table: row.table })}</span>}
                        >
                          <Squares marks={[row.mark]} />
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <Show when={proving()}>
            <IdentifyForm
              view={props.view}
              idPrefix='sheet'
              submitLabel={t('Confirm')}
              expect={props.playerId}
              autofocus
              onFound={found => {
                setProving(false);
                props.onIdentified(found);
              }}
            />
          </Show>
        </div>
        <div class='tm-sheet-foot'>
          <button
            type='button'
            class='btn btn-secondary tm-follow'
            aria-pressed={props.following}
            onClick={() => props.onFollow()}
          >
            {props.following ? t('Following') : t('Follow')}
          </button>
          <Show when={props.me === props.playerId}>
            <button type='button' class='btn btn-ghost' onClick={() => props.onForget()}>
              {t('This isn’t me')}
            </button>
          </Show>
          <Show when={props.me === null}>
            <Show
              when={proving()}
              fallback={
                <button type='button' class='btn btn-primary' onClick={() => setProving(true)}>
                  {t('This is me')}
                </button>
              }
            >
              <button type='button' class='btn btn-ghost' onClick={() => setProving(false)}>
                {t('Cancel')}
              </button>
            </Show>
          </Show>
        </div>
      </div>
    </>
  );
}
