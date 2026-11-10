/**
 * The main site's print index (its card synonyms and price list on R2), for a
 * card whose own art is nowhere: an alternate art or reprint draws as the
 * print it counts as, and a Trainer or Energy named without its print draws
 * as the one that stands for its name. A Pokémon needs its set, since one
 * name can be several cards; with it, a name that is a single card in that
 * set draws as that card. The price list names every print, not only those
 * played at an event, so a set's cards are read from both. The index loads
 * only when a card first needs it.
 */

import type { DeckCard } from '../../shared/tournament/decklist';
import { type CardArt, cardArt, cardPrint } from './cardArt';
import { R2_ORIGIN } from './constants';

/** The files as the main site publishes them: card ids are "Name::SET::NUM". */
interface SynonymFile {
  synonyms: Record<string, string>;
  canonicals: Record<string, string>;
  /** Every print the main site knows, to its price. */
  prints: Record<string, unknown>;
}

interface PriceFile {
  cardPrices: Record<string, unknown>;
}

export interface PrintIndex {
  /** Each print's id to the id of the print it counts as. */
  canonical: Map<string, string>;
  /** Each name to the id of the print that stands for it. */
  byName: Map<string, string>;
  /** "name::SET" to the prints it counts as. */
  bySet: Map<string, Set<string>>;
}

/** A name as it is looked up: no accents, straight apostrophes, any case. */
const nameKey = (name: string) =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** "Name::SET::NUM" with its name looked up as nameKey. */
function idKey(id: string): string {
  const [name = '', ...rest] = id.split('::');
  return [nameKey(name), ...rest].join('::');
}

export function printIndex(file: SynonymFile, prices: PriceFile = { cardPrices: {} }): PrintIndex {
  const canonical = new Map(Object.entries(file.synonyms).map(([id, to]) => [idKey(id), to]));
  const byName = new Map(Object.entries(file.canonicals).map(([name, id]) => [nameKey(name), id]));
  const bySet = new Map<string, Set<string>>();
  for (const id of [...Object.keys(file.prints), ...Object.keys(prices.cardPrices)]) {
    const [name = '', set = ''] = id.split('::');
    const key = `${nameKey(name)}::${set}`;
    bySet.set(key, (bySet.get(key) ?? new Set()).add(file.synonyms[id] ?? id));
  }
  return { canonical, byName, bySet };
}

/** The id of the print a card draws as, or undefined when the index cannot tell. */
export function canonicalId(index: PrintIndex, card: Pick<DeckCard, 'name' | 'set' | 'number' | 'section'>) {
  const name = nameKey(card.name);
  const { set, number } = cardPrint(card);
  const inSet = [...(index.bySet.get(`${name}::${set}`) ?? [])];
  return (
    (number === null ? undefined : index.canonical.get(`${name}::${set}::${number.toUpperCase()}`)) ??
    (card.section === 'pokemon' ? undefined : index.byName.get(name)) ??
    (inSet.length === 1 ? inSet[0] : undefined)
  );
}

const read = <T>(path: string) =>
  fetch(`${R2_ORIGIN}${path}`).then(response =>
    response.ok ? (response.json() as Promise<T>) : Promise.reject(new Error(path))
  );

let loading: Promise<PrintIndex | null> | null = null;

/**
 * The index, fetched once; without the synonyms a failed fetch is forgotten so the next card asks
 * again, and without the price list a set's cards are those the synonyms know.
 */
function loadIndex(): Promise<PrintIndex | null> {
  loading ??= Promise.all([
    read<SynonymFile>('/assets/card-synonyms.json'),
    read<PriceFile>('/reports/prices.json').catch(() => undefined)
  ])
    .then(([file, prices]) => printIndex(file, prices))
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

/** The art of the print a card counts as, from the mirror and then the original; none when there is none to find. */
export async function canonicalArt(card: Pick<DeckCard, 'name' | 'set' | 'number' | 'section'>): Promise<CardArt[]> {
  const index = await loadIndex();
  const id = index ? canonicalId(index, card) : undefined;
  const [name = '', set = '', number = ''] = id?.split('::') ?? [];
  return id ? [cardArt({ name, set, number }), cardArt({ name, set, number }, true)].filter(art => art !== null) : [];
}
