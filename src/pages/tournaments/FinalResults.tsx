/**
 * A finished event's finish line, under its head: each division's winner,
 * their deck where decks are public, their record, and the field they beat.
 * Open between the head and the tabs, with no rules of its own.
 */

import { For, Show } from 'solid-js';
import { recordLabel } from '../../../shared/tournament/standings';
import type { Division } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { t, tn } from '../../lib/i18n';
import { finalResults, namesById } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

export function FinalResults(props: { view: TournamentView; divisionOf: (id: string) => Division }) {
  const results = () => finalResults(props.view.tournament, props.divisionOf);
  const names = () => namesById(props.view.tournament);
  return (
    <Show when={results().length > 0}>
      <section class='tm-final' aria-labelledby='final-results'>
        <h2 class='tm-subhead' id='final-results'>
          {t('Final results')}
        </h2>
        <For each={results()}>
          {result => (
            <div class='tm-final-row'>
              <span class='tm-final-who'>
                <strong class='tm-final-name'>{names().get(result.winner.playerId)}</strong>
                <span class='tm-final-sub muted'>
                  {result.label ? t('{division} winner', { division: result.label }) : t('Winner')}
                  <Show when={props.view.decks[result.winner.playerId]}>
                    {deck => (
                      <span class='tm-final-deck'>
                        {' · '}
                        <DeckIcons label={deck()} />
                        {deck()}
                      </span>
                    )}
                  </Show>
                </span>
              </span>
              <span class='tm-final-field num'>
                {recordLabel(result.winner.record)} · {tn(result.winner.points, '{n} pt', '{n} pts')}
                <small class='muted'>
                  {result.cut
                    ? t('{players} · Top {n}', {
                        players: tn(result.players, '{n} player', '{n} players'),
                        n: result.cut
                      })
                    : tn(result.players, '{n} player', '{n} players')}
                </small>
              </span>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
