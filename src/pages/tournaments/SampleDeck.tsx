import { Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { SAMPLE_DECKS } from '../../lib/tournament/sampleEvent';

/** A sample player's deck as the site draws one beside a name: its sprites, the name kept for assistive tech. */
export function SampleDeck(props: { player: string | null; size?: number; named?: boolean }) {
  const deck = () => (props.player ? SAMPLE_DECKS[props.player] : undefined);
  return (
    <Show when={deck()}>
      {d => (
        <span class='tm-deck' title={d().label}>
          <ArchetypeIcons slugs={d().icons} size={props.size ?? 20} />
          <Show when={props.named} fallback={<span class='sr-only'>{d().label}</span>}>
            <span>{d().label}</span>
          </Show>
        </span>
      )}
    </Show>
  );
}
