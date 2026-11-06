/**
 * Where a decklist card's art comes from: the main site's WebP copies on R2,
 * at three widths, keyed by set code and a three-digit collector number as
 * Limitless names its files. Basic Energy is drawn from its Scarlet & Violet
 * printing whatever set the list names, since older exports give it the set
 * "Energy". A card no URL can be built for draws as its name instead.
 */

import type { DeckCard, DeckSection } from '../../shared/tournament/decklist';
import { R2_ORIGIN } from './constants';

/** How a card's art window is framed when it is cropped (see .tm-crop). */
export type ArtCrop = 'pokemon' | 'trainer' | 'energy-basic' | 'energy-special';

const ART = `${R2_ORIGIN}/card-images`;

/** Each tier's width, for srcset. */
const TIERS = { XS: 136, SM: 274, LG: 460 } as const;

/** Scarlet & Violet Energy's collector number for each type's symbol and name. */
const BASIC_ENERGY: Record<string, string> = {
  G: '1',
  R: '2',
  W: '3',
  L: '4',
  P: '5',
  F: '6',
  D: '7',
  M: '8',
  grass: '1',
  fire: '2',
  water: '3',
  lightning: '4',
  psychic: '5',
  fighting: '6',
  darkness: '7',
  metal: '8'
};

const BASIC_RE = /^(?:basic\s+\{([A-Z])\}|(grass|fire|water|lightning|psychic|fighting|darkness|metal))\s+energy$/i;

/** The SVE number of a Basic Energy, by its name; undefined for any other card. */
function basicEnergy(name: string): string | undefined {
  const match = BASIC_RE.exec(name.trim());
  return match ? BASIC_ENERGY[match[1]?.toUpperCase() ?? match[2]?.toLowerCase() ?? ''] : undefined;
}

/** Limitless's file number: three digits, and any letter suffix lower-cased ("8a" is "008a"). */
function fileNumber(number: string): string | null {
  const parts = /^0*(\d{1,3})([a-z]*)$/i.exec(number);
  return parts ? `${parts[1]!.padStart(3, '0')}${parts[2]!.toLowerCase()}` : null;
}

function url(set: string, number: string, tier: keyof typeof TIERS, original: boolean): string {
  const origin = original ? 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci' : ART;
  const extension = original ? 'png' : 'webp';
  return `${origin}/${set}/${set}_${number}_R_EN_${tier}.${extension}`;
}

export interface CardArt {
  /** The smallest tier, for a crop a few dozen pixels wide. */
  small: string;
  /** The middle tier, for browsers that ignore srcset. */
  src: string;
  srcset: string;
  /** The largest tier alone, for the full-size look. */
  large: string;
}

/** The art for a card as a list names it, or null when its print is unknown. */
export function cardArt(card: Pick<DeckCard, 'name' | 'set' | 'number'>, original = false): CardArt | null {
  const energy = basicEnergy(card.name);
  const set = energy ? 'SVE' : card.set.toUpperCase();
  const number = fileNumber(energy ?? card.number);
  if (!/^[A-Z0-9-]{2,6}$/.test(set) || number === null) {
    return null;
  }
  return {
    small: url(set, number, 'XS', original),
    src: url(set, number, 'SM', original),
    srcset: (Object.keys(TIERS) as (keyof typeof TIERS)[])
      .map(tier => `${url(set, number, tier, original)} ${TIERS[tier]}w`)
      .join(', '),
    large: url(set, number, 'LG', original)
  };
}

/** Where a crop of the card frames its art: by section, and for Energy, whether it is basic. */
export function artCrop(card: { name: string; section: DeckSection }): ArtCrop {
  if (card.section !== 'energy') {
    return card.section;
  }
  return basicEnergy(card.name) ? 'energy-basic' : 'energy-special';
}
