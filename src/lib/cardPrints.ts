/**
 * The main site's print index (its card synonyms on R2), for a card whose own
 * art is nowhere: an alternate art or reprint draws as the print it counts as,
 * and a Trainer or Energy named without its print draws as the one that
 * stands for its name. A Pokémon needs its set, since one name can be several
 * cards; with it, a name that is a single card in that set draws as that card.
 * The index loads only when a card first needs it.
 */

import type { DeckCard } from '../../shared/tournament/decklist';
import { type CardArt, cardArt, cardPrint } from './cardArt';
import { R2_ORIGIN } from './constants';

/** The file as the main site publishes it: card ids are "Name::SET::NUM". */
interface SynonymFile {
  synonyms: Record<string, string>;
  canonicals: Record<string, string>;
  /** Every print the main site knows, to its price. */
  prints: Record<string, unknown>;
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

export function printIndex(file: SynonymFile): PrintIndex {
  const canonical = new Map(Object.entries(file.synonyms).map(([id, to]) => [idKey(id), to]));
  const byName = new Map(Object.entries(file.canonicals).map(([name, id]) => [nameKey(name), id]));
  const bySet = new Map<string, Set<string>>();
  for (const id of Object.keys(file.prints)) {
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

let loading: Promise<PrintIndex | null> | null = null;

/** The index, fetched once; a failed fetch is forgotten so the next card asks again. */
function loadIndex(): Promise<PrintIndex | null> {
  loading ??= fetch(`${R2_ORIGIN}/assets/card-synonyms.json`)
    .then(response => (response.ok ? (response.json() as Promise<SynonymFile>) : Promise.reject(new Error())))
    .then(printIndex)
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

/** The art of the print a card counts as, or null when there is none to find. */
export async function canonicalArt(
  card: Pick<DeckCard, 'name' | 'set' | 'number' | 'section'>
): Promise<CardArt | null> {
  const index = await loadIndex();
  const id = index ? canonicalId(index, card) : undefined;
  const [name = '', set = '', number = ''] = id?.split('::') ?? [];
  return id ? cardArt({ name, set, number }) : null;
}
