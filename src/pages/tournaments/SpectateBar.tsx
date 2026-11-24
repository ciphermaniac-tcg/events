/**
 * What a spectator narrows the pairings to: every table, the ones still
 * playing (while a Swiss round of an event still running can have any), or
 * the players they follow (once they follow anyone, from a player's sheet),
 * and where decks are public, one archetype.
 */

import { For, Show } from 'solid-js';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { t } from '../../lib/i18n';
import type { Showing, SpectateFilter } from '../../lib/tournament/spectate';

export function SpectateBar(props: {
  filter: SpectateFilter;
  /** The archetypes played this round, most played first. */
  decks: readonly string[];
  following: number;
  /** Whether In progress can narrow anything. */
  live: boolean;
  onFilter: (filter: SpectateFilter) => void;
}) {
  const options = () => [
    { value: 'all' as const, label: t('All') },
    ...(props.live ? [{ value: 'playing' as const, label: t('In progress') }] : []),
    ...(props.following > 0 ? [{ value: 'following' as const, label: t('Following {n}', { n: props.following }) }] : [])
  ];
  return (
    <span class='tm-spectate'>
      {/* A lone All offers nothing to choose, so it hides (tournament-public.css). */}
      <Segmented
        options={options()}
        selected={props.filter.showing}
        onSelect={(showing: Showing) => props.onFilter({ ...props.filter, showing })}
        ariaLabel={t('Show tables')}
      />
      <Show when={props.decks.length > 0}>
        <select
          class='tm-select'
          aria-label={t('Deck')}
          onChange={e => props.onFilter({ ...props.filter, deck: e.currentTarget.value || null })}
        >
          <option value='' selected={props.filter.deck === null}>
            {t('All decks')}
          </option>
          <For each={props.decks}>
            {deck => (
              <option value={deck} selected={props.filter.deck === deck}>
                {deck}
              </option>
            )}
          </For>
        </select>
      </Show>
    </span>
  );
}
