/**
 * Every round a player played, in their sheet: the round, the opponent with
 * their deck and record (pressed, the opponent's own sheet), and the result,
 * or the table while the match is still on.
 */

import { For, Show } from 'solid-js';
import { isBye } from '../../../shared/tournament/standings';
import type { Pod } from '../../../shared/tournament/types';
import { matchHistory } from '../../lib/tournament/present';
import { t } from '../../lib/i18n';
import { DeckIcons } from './DeckIcons';
import { Squares } from './Squares';

export function HistoryTable(props: {
  pod: Pod;
  playerId: string;
  names: Map<string, string>;
  /** Each player's record so far. */
  records: Map<string, string>;
  decks: Record<string, string>;
  onPlayer: (id: string) => void;
}) {
  const history = () => matchHistory(props.pod, props.playerId);
  return (
    <div class='tm-box'>
      <table class='data tm-history'>
        <caption class='sr-only'>
          {t('Rounds played by {name}', { name: props.names.get(props.playerId) ?? '' })}
        </caption>
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
                    fallback={<span class='muted'>{isBye(row.outcome) ? t('Bye') : t('Missed round')}</span>}
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
  );
}
