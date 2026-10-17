/**
 * What deck a pasted list is, read from its cards. Each archetype is known
 * by its signature cards and how often they show in its lists, as the main
 * site's archetype index publishes them (see functions/lib/tournaments/
 * archetypeRules.ts), with a few rules kept here by hand for decks the index
 * misses or names too broadly. A list is the archetype whose signature it
 * holds the most of, weighed by how often each card shows, once it holds at
 * least half; the more common deck breaks a tie. A list that holds too little
 * of any is nobody's: staff name it.
 */

import { type DeckCard, parseDecklist } from './decklist.js';

export interface SignatureCard {
  name: string;
  /** Of the archetype's lists, the share that play the card, 0 to 100. */
  pct: number;
}

export interface ArchetypeRule {
  label: string;
  signatureCards: SignatureCard[];
  /** How many lists the archetype was read from: the tiebreak, for the more common deck. */
  deckCount: number;
}

/**
 * How much of an archetype's signature a list must hold to be it, weighed by
 * how often each card shows in the archetype's lists. One card many decks
 * play (a Stadium, a common Supporter) is never enough alone.
 */
const ENOUGH = 0.5;

/**
 * Rules kept by hand, read before the index's: each names a deck the index
 * does not tell apart. Keep them few, and drop one once the index has it.
 */
export const HAND_RULES: readonly ArchetypeRule[] = [];

const cardKey = (name: string) =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

/** The share of the rule's signature the list holds, weighed by each card's share; null when that is not enough. */
function fit(names: ReadonlySet<string>, rule: ArchetypeRule): number | null {
  const total = rule.signatureCards.reduce((sum, card) => sum + card.pct, 0);
  const held = rule.signatureCards.reduce((sum, card) => sum + (names.has(cardKey(card.name)) ? card.pct : 0), 0);
  return total > 0 && held / total >= ENOUGH ? held / total : null;
}

/** The archetype the cards are, or null when no rule fits them. */
export function archetypeOfCards(
  cards: readonly Pick<DeckCard, 'name'>[],
  rules: readonly ArchetypeRule[]
): string | null {
  const names = new Set(cards.map(card => cardKey(card.name)));
  let best: { label: string; score: number; deckCount: number } | null = null;
  for (const rule of [...HAND_RULES, ...rules]) {
    const score = fit(names, rule);
    const better =
      score !== null && (!best || score > best.score || (score === best.score && rule.deckCount > best.deckCount));
    if (better) {
      best = { label: rule.label, score, deckCount: rule.deckCount };
    }
  }
  return best?.label ?? null;
}

/** The archetype a pasted list is, or null when no rule fits it. */
export const archetypeOfList = (deck: string, rules: readonly ArchetypeRule[]): string | null =>
  deck.trim() ? archetypeOfCards(parseDecklist(deck).cards, rules) : null;

/** The rules in the main site's archetype index, keeping only entries that read as one; anything else is skipped. */
export function rulesFromIndex(index: unknown): ArchetypeRule[] {
  if (!Array.isArray(index)) {
    return [];
  }
  return index.flatMap((entry: unknown): ArchetypeRule[] => {
    const { label, signatureCards, deckCount } = (entry ?? {}) as Record<string, unknown>;
    if (typeof label !== 'string' || !label || !Array.isArray(signatureCards)) {
      return [];
    }
    const cards = signatureCards.flatMap((card: unknown): SignatureCard[] => {
      const { name, pct } = (card ?? {}) as Record<string, unknown>;
      return typeof name === 'string' && typeof pct === 'number' ? [{ name, pct }] : [];
    });
    return cards.length
      ? [{ label, signatureCards: cards, deckCount: typeof deckCount === 'number' ? deckCount : 0 }]
      : [];
  });
}
