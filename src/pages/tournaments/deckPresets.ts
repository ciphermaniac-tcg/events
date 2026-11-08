/**
 * The Players tab's deck picker list: the format's archetypes (see
 * deckOptions), or the fixed presets of a format the site has no meta for,
 * with the event's own decks laid over them. A deck already entered at the
 * event counts as played, so it is offered with the format's, and one the
 * format's list lacks (typed in by hand) joins it.
 */

import { type Accessor, createMemo, createResource } from 'solid-js';
import { latestValue } from '../../lib/resource';
import type { ReportedDeck } from '../live/reportedDeck';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { decksFor } from './deckOptions';

const PRERELEASE_END = Date.UTC(2026, 10, 7);
const PRERELEASE_DECKS: ReportedDeck[] = ['Enamorus', 'Kommo-o', 'Masquerain', 'Magmortar'].map(label => ({
  label,
  played: true
}));
const GLC_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Fighting',
  'Psychic',
  'Darkness',
  'Metal',
  'Dragon',
  'Colorless',
  'Fairy'
];
const GLC_DECKS: ReportedDeck[] = GLC_TYPES.map(label => ({ label, played: true, type: true }));

function nicheDecks(format: string, startDate: string): ReportedDeck[] | null {
  if (format === 'Gym Leader Challenge') {
    return GLC_DECKS;
  }
  if (format !== 'Prerelease') {
    return null;
  }
  const date = parseTomDate(startDate);
  return date && date.getTime() < PRERELEASE_END ? PRERELEASE_DECKS : null;
}

function withEventDecks(decks: readonly ReportedDeck[], labels: readonly string[]): ReportedDeck[] {
  const used = new Set(labels);
  const known = new Set(decks.map(deck => deck.label));
  const typed = [...used].filter(label => !known.has(label)).map(label => ({ label, played: true }));
  return [...decks.map(deck => (used.has(deck.label) && !deck.played ? { ...deck, played: true } : deck)), ...typed];
}

let last: { decks: readonly ReportedDeck[]; key: string; result: ReportedDeck[] } | null = null;

/** What an event's picker list is drawn from. */
interface DeckEvent {
  format: string;
  startDate: string;
  /** The format's archetypes once they have loaded. */
  loaded?: readonly ReportedDeck[] | undefined;
  /** The decks entered at the event so far. */
  inEvent: readonly string[];
}

/**
 * The picker's list for an event, kept from the last call while the list and
 * the event's decks are the same: the pairings draw a picker per seat, and an
 * event polled anew asks again for the same list.
 */
export function deckList(event: DeckEvent): ReportedDeck[] {
  const decks = nicheDecks(event.format, event.startDate) ?? event.loaded ?? [];
  const key = event.inEvent.join('\n');
  if (last?.decks !== decks || last.key !== key) {
    last = { decks, key, result: withEventDecks(decks, event.inEvent) };
  }
  return last.result;
}

/** The picker's list for the event `manage` is, loading the format's archetypes unless it has presets of its own. */
export function createDeckOptions(
  manage: Accessor<{
    settings: { format: string };
    tournament: { info: { startDate: string } };
    decks: Record<string, string>;
  }>
): Accessor<ReportedDeck[]> {
  const format = () => manage().settings.format;
  const startDate = () => manage().tournament.info.startDate;
  const [loaded] = createResource(() => (nicheDecks(format(), startDate()) ? false : format()), decksFor);
  return createMemo(() =>
    deckList({
      format: format(),
      startDate: startDate(),
      loaded: latestValue(loaded),
      inEvent: Object.values(manage().decks)
    })
  );
}
