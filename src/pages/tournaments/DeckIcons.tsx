import { createSignal, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { normalizeArchetypeKey } from '../../../shared/data/archetypes/winRate';
import { deckIcons, deckIconsSettled } from '../../lib/deckIcons';

/**
 * Sprites for archetypes the site's own icon map does not name, as a past
 * format's archetypes give them (see deckOptions). Learned once the format's
 * list loads, so every name on the page draws the sprites it was picked with.
 */
const [learned, setLearned] = createSignal(new Map<string, string[]>());

export function learnDeckIcons(decks: readonly { label: string; icons?: string[] }[]): void {
  const next = new Map(learned());
  for (const deck of decks) {
    if (deck.icons?.length) {
      next.set(normalizeArchetypeKey(deck.label), deck.icons);
    }
  }
  setLearned(next);
}

const slugs = (label: string) => learned().get(normalizeArchetypeKey(label)) ?? deckIcons({ label });

/** The sprites DeckIcons draws for a deck, the Substitute doll's slug standing in once the lookups find none. */
export function deckSprites(label: string): string[] {
  const found = slugs(label).slice(0, 2);
  return found.length > 0 || !deckIconsSettled() ? found : ['substitute'];
}

/**
 * A player's archetype the way the site writes one: its sprites, the name kept
 * for assistive tech. A deck with no sprite of its own (a rogue deck, a new
 * archetype, a typo) shows the Substitute doll once the lookups have answered,
 * so a reported deck never looks like no deck where only the icon is drawn.
 */
export function DeckIcons(props: { label: string | undefined; size?: number }) {
  return (
    <Show when={props.label}>
      {label => (
        <span class='tm-deck' title={label()}>
          <ArchetypeIcons slugs={slugs(label())} size={props.size ?? 20} placeholder={deckIconsSettled()} />
          <span class='sr-only'>{label()}</span>
        </span>
      )}
    </Show>
  );
}
