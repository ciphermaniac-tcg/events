/** A decklist as it was pasted, laid out by section with each section's count, and any lines not read as a card. */

import { For, Show } from 'solid-js';
import { type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';

const SECTIONS: { section: DeckSection; label: string }[] = [
  { section: 'pokemon', label: 'Pokémon' },
  { section: 'trainer', label: 'Trainer' },
  { section: 'energy', label: 'Energy' }
];

export function DecklistColumns(props: { deck: string }) {
  const parsed = () => parseDecklist(props.deck);
  return (
    <div class='tm-list-columns'>
      <For each={SECTIONS}>
        {s => {
          const cards = () => parsed().cards.filter(card => card.section === s.section);
          return (
            <div>
              <p class='tm-list-head'>
                {s.label}: {cards().reduce((sum, card) => sum + card.count, 0)}
              </p>
              <ul class='tm-list-cards'>
                <For each={cards()}>
                  {card => (
                    <li>
                      {card.count} {card.name} {card.set} {card.number}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          );
        }}
      </For>
      <Show when={parsed().unread.length > 0}>
        <div>
          <p class='tm-list-head'>Not read</p>
          <ul class='tm-list-cards tm-problem'>
            <For each={parsed().unread}>{line => <li>{line}</li>}</For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
