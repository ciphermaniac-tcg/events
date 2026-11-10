/**
 * Where a decklist card's art comes from: the main site's WebP copies on R2,
 * at three widths, keyed by set code and a three-digit collector number as
 * Limitless names its files. Basic Energy is drawn from its Scarlet & Violet
 * printing whatever set the list names, since older exports give it the set
 * "Energy". PTCGL's own codes for promos and galleries are read as Limitless's
 * ("PR-SV 30" is SVP 030, "LOR-TG 24" is LOR TG24). A card no URL can be built
 * for draws as its name instead, unless the main site's print index knows it
 * (see cardPrints).
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

const BASIC_RE =
  /^(?:basic\s+)?(?:\{([A-Z])\}|(grass|fire|water|lightning|psychic|fighting|darkness|metal))\s+energy$/i;

/** PTCGL's promo codes, as Limitless files them. */
const PROMOS: Record<string, string> = {
  'PR-SV': 'SVP',
  'PR-SW': 'SP',
  'PR-SM': 'SMP',
  'PR-XY': 'XYP',
  'PR-BLW': 'BWP'
};

/** PTCGL's gallery codes: "LOR-TG" is LOR's Trainer Gallery, whose numbers Limitless writes "TG24". */
const GALLERY_RE = /^([A-Z0-9]{2,5})-(TG|GG)$/;

/** The SVE number of a Basic Energy, by its name; undefined for any other card. */
function basicEnergy(name: string): string | undefined {
  const match = BASIC_RE.exec(name.trim());
  return match ? BASIC_ENERGY[match[1]?.toUpperCase() ?? match[2]?.toLowerCase() ?? ''] : undefined;
}

/**
 * Limitless's file number: three digits, and any letter suffix lower-cased ("8a" is "008a"); a
 * gallery number keeps its letters and two digits ("TG5" is "TG05").
 */
function fileNumber(number: string): string | null {
  const gallery = /^(TG|GG|SV|RC)0*(\d{1,3})$/i.exec(number);
  if (gallery) {
    return `${gallery[1]!.toUpperCase()}${gallery[2]!.padStart(2, '0')}`;
  }
  const parts = /^0*(\d{1,3})([a-z]*)$/i.exec(number);
  return parts ? `${parts[1]!.padStart(3, '0')}${parts[2]!.toLowerCase()}` : null;
}

/** The print a list names, as Limitless files it; its number is null when the list gives none that reads. */
export function cardPrint(card: Pick<DeckCard, 'name' | 'set' | 'number'>): { set: string; number: string | null } {
  const energy = basicEnergy(card.name);
  if (energy) {
    return { set: 'SVE', number: fileNumber(energy) };
  }
  const set = card.set.toUpperCase();
  const gallery = GALLERY_RE.exec(set);
  if (gallery) {
    return { set: gallery[1]!, number: fileNumber(`${gallery[2]!}${card.number}`) };
  }
  return { set: PROMOS[set] ?? set, number: fileNumber(card.number) };
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
  const { set, number } = cardPrint(card);
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
