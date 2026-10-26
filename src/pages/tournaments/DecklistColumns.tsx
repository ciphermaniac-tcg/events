/**
 * A decklist as it was pasted, laid out by section with each section's count,
 * the deck's total, and any lines not read as a card. Each card's count sits
 * in a column of its own, for a judge reading it against the cards on a table.
 */

import { createMemo, For, Show } from 'solid-js';
import { msg, t, tn } from '../../lib/i18n';
import { DECK_SIZE, type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';

const SECTIONS: { section: DeckSection; label: string }[] = [
  { section: 'pokemon', label: 'Pokémon' },
  { section: 'trainer', label: msg('Trainer') },
  { section: 'energy', label: msg('Energy') }
];

export function DecklistColumns(props: { deck: string }) {
  const parsed = createMemo(() => parseDecklist(props.deck));
  // A section the list has no cards in is left out rather than counted as none.
  const sections = () =>
    SECTIONS.map(s => ({ ...s, cards: parsed().cards.filter(card => card.section === s.section) })).filter(
      s => s.cards.length > 0
    );
  return (
    <>
      <div class='tm-list-columns'>
        <For each={sections()}>
          {s => (
            <div>
              <p class='tm-list-head'>
                {t(s.label)}: {s.cards.reduce((sum, card) => sum + card.count, 0)}
              </p>
              <ul class='tm-list-cards'>
                <For each={s.cards}>
                  {card => (
                    <li class='tm-list-card'>
                      <span class='num'>{card.count}</span>
                      <span>
                        {card.name} <span class='tm-list-print'>{[card.set, card.number].join(' ')}</span>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
        <Show when={parsed().unread.length > 0}>
          <div>
            <p class='tm-list-head'>{t('Not read')}</p>
            <ul class='tm-list-cards tm-problem'>
              <For each={parsed().unread}>{line => <li>{line}</li>}</For>
            </ul>
          </div>
        </Show>
      </div>
      <Show when={parsed().total > 0}>
        <p class='tm-list-total num' classList={{ 'is-off': parsed().total !== DECK_SIZE }}>
          {tn(parsed().total, '{n} card', '{n} cards')}
        </p>
      </Show>
    </>
  );
}
