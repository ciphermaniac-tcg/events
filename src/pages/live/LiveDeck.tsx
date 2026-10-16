import { Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { Combo, splitMatch } from '../../components/Combo';
import { deckIcons, loadedSpecies } from '../../lib/deckIcons';
import { pairSearch } from './deckPairs';
import type { ReportedDeck } from './reportedDeck';
import { intlLocale, t } from '../../lib/i18n';

const shareText = (share: number) =>
  new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(Math.round(share) / 100);

/**
 * The deck typeahead, wherever a deck is named: sprites in the field and in the
 * list, what the format is playing browsable and ranked first, the long tail of
 * the icon map under a rule. Once one Pokémon's whole name and a space are
 * typed, the rest of the query names a second (see pairSearch).
 */
export function DeckCombo(props: {
  decks: readonly ReportedDeck[];
  /** The deck the box stands for while it is not being typed in. */
  selected?: ReportedDeck;
  placeholder: string;
  width?: string;
  /** Whether a name the list lacks can be typed in and picked as it is, up to `custom` characters. */
  custom?: number;
  onPick: (deck: ReportedDeck) => void;
}) {
  const create = () => {
    const max = props.custom;
    return max ? (query: string) => ({ label: query.trim().slice(0, max), custom: true }) : undefined;
  };
  const weight = (deck: ReportedDeck) => deck.percent ?? 0;
  const tier = (deck: ReportedDeck) => (deck.custom ? 2 : deck.played ? 0 : 1);
  const search = (query: string) => {
    const species = loadedSpecies();
    return species ? pairSearch(props.decks, query, species, { weight, tier }) : undefined;
  };
  return (
    <Combo<ReportedDeck>
      placeholder={props.placeholder}
      options={props.decks}
      browse={props.decks.filter(deck => deck.played)}
      label={deck => deck.label}
      weight={weight}
      tier={tier}
      search={search}
      selected={props.selected}
      adorn={deck => <ArchetypeIcons slugs={deckIcons(deck)} size={20} />}
      onPick={deck => props.onPick(deck.pair ? { label: deck.pair } : deck)}
      create={create()}
      width={props.width}
    >
      {(deck, query) => <DeckOption deck={deck} query={query} />}
    </Combo>
  );
}

function DeckOption(props: { deck: ReportedDeck; query: string }) {
  const parts = () => splitMatch(props.deck.label, props.query);
  return (
    <>
      <ArchetypeIcons slugs={deckIcons(props.deck)} size={26} reserveSlot />
      <b>
        {parts()[0]}
        <mark>{parts()[1]}</mark>
        {parts()[2]}
      </b>
      <span>
        <Show when={!props.deck.custom} fallback={t('Custom')}>
          <Show when={props.deck.percent}>{share => shareText(share())}</Show>
        </Show>
      </span>
    </>
  );
}
