import { type Accessor, createMemo, createResource, type Resource } from 'solid-js';
import { latestValue } from '../../lib/resource';
import type { ReportedDeck } from '../live/reportedDeck';
import { eventDecks } from './eventDecks';
import { parseTomDate } from '../../../shared/tournament/divisions';

export type DeckResource = (
  source: Accessor<string | false>,
  fetcher: (format: string) => Promise<ReportedDeck[]>
) => [Resource<ReportedDeck[] | undefined>];
const resource = createResource as unknown as DeckResource;

interface DeckOptionsSettings {
  inEvent?: Accessor<readonly string[]>;
  startDate?: Accessor<string>;
  createResource?: DeckResource;
}

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

export function nicheDecks(format: string, startDate: string): ReportedDeck[] | null {
  if (format === 'Gym Leader Challenge') {
    return GLC_DECKS;
  }
  if (format !== 'Prerelease') {
    return null;
  }
  const date = parseTomDate(startDate);
  return date && date.getTime() < PRERELEASE_END ? PRERELEASE_DECKS : null;
}

/** The picker's options for the event's format, with the decks already entered at the event. */
export function createDeckOptions(
  format: Accessor<string>,
  loadDecks: (format: string) => Promise<ReportedDeck[]>,
  settings: DeckOptionsSettings = {}
): Accessor<ReportedDeck[]> {
  const inEvent = settings.inEvent ?? (() => []);
  const startDate = settings.startDate ?? (() => '');
  const [decks] = (settings.createResource ?? resource)(
    () => (nicheDecks(format(), startDate()) ? false : format()),
    loadDecks
  );
  return createMemo(() => eventDecks(nicheDecks(format(), startDate()) ?? latestValue(decks) ?? [], inEvent()));
}
