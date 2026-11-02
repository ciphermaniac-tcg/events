/**
 * What deck a pasted list is, read from its cards by Play! Limitless's deck
 * categorization rules, as the main site publishes them each day (see
 * functions/lib/tournaments/archetypeRules.ts), so a list here is named as
 * Limitless names the same list. A rule names the cards a deck holds, each at
 * least so many times, by exact name and by set or number where the rule
 * gives one. Rules are tried from the lowest priority up, in the order
 * Limitless sends them, and the first a list holds names it; then the first
 * of that rule's variants it also holds names it more closely. A list no rule
 * fits is nobody's: staff name it.
 */

import { type DeckCard, parseDecklist } from './decklist.js';

export interface RuleCard {
  name: string;
  /** The fewest copies the list must hold. */
  count: number;
  set?: string;
  number?: string;
}

export interface DeckVariant {
  identifier: string;
  name: string;
  icons: string[];
  cards: RuleCard[];
}

export interface DeckRule extends DeckVariant {
  /** Lower first. */
  priority: number;
  variants: DeckVariant[];
}

const cardKey = (name: string) =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

/** A collector number as sets print them, without the zeros some lists lead it with. */
const numberKey = (number: string) => number.replace(/^0+(?=\d)/, '').toLowerCase();

/** How many of each card the list holds: by name, by name and set, by name and number, and by all three. */
function holdings(cards: readonly Pick<DeckCard, 'name' | 'set' | 'number' | 'count'>[]): Map<string, number> {
  const held = new Map<string, number>();
  const add = (key: string, count: number) => held.set(key, (held.get(key) ?? 0) + count);
  for (const card of cards) {
    const name = cardKey(card.name);
    const set = card.set.toUpperCase();
    add(name, card.count);
    add(`${name}|${set}`, card.count);
    add(`${name}|${set}|${numberKey(card.number)}`, card.count);
    add(`${name}||${numberKey(card.number)}`, card.count);
  }
  return held;
}

/** The holding a rule card asks after (see holdings): a set or number it gives narrows the name to that print. */
function ruleKey(card: RuleCard): string {
  const name = cardKey(card.name);
  const set = card.set?.toUpperCase() ?? '';
  if (card.number === undefined) {
    return set ? `${name}|${set}` : name;
  }
  return `${name}|${set}|${numberKey(card.number)}`;
}

const holdsAll = (held: ReadonlyMap<string, number>, cards: readonly RuleCard[]) =>
  cards.every(card => (held.get(ruleKey(card)) ?? 0) >= card.count);

/** The archetype the cards are, or null when no rule fits them. */
export function archetypeOfCards(
  cards: readonly Pick<DeckCard, 'name' | 'set' | 'number' | 'count'>[],
  rules: readonly DeckRule[]
): string | null {
  const held = holdings(cards);
  const rule = byPriority(rules).find(each => holdsAll(held, each.cards));
  return rule ? (rule.variants.find(variant => holdsAll(held, variant.cards))?.name ?? rule.name) : null;
}

// Each rule set's order, worked out once: a rule set is read every six hours, and a list is named every submission.
const sorted = new WeakMap<readonly DeckRule[], DeckRule[]>();

/** The rules from the lowest priority up; rules of one priority keep the order Limitless sent them in. */
function byPriority(rules: readonly DeckRule[]): DeckRule[] {
  const known = sorted.get(rules);
  if (known) {
    return known;
  }
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  sorted.set(rules, ordered);
  return ordered;
}

/** The archetype a pasted list is, or null when no rule fits it. */
export const archetypeOfList = (deck: string, rules: readonly DeckRule[]): string | null =>
  deck.trim() ? archetypeOfCards(parseDecklist(deck).cards, rules) : null;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function ruleCard(value: unknown): RuleCard[] {
  const raw = (value ?? {}) as Record<string, unknown>;
  const name = text(raw.name);
  if (!name || typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1) {
    return [];
  }
  const set = text(raw.set);
  const number = text(raw.number);
  return [{ name, count: raw.count, ...(set ? { set } : {}), ...(number ? { number } : {}) }];
}

function variantOf(value: unknown): DeckVariant | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const identifier = text(raw.identifier);
  const name = text(raw.name);
  const cards = Array.isArray(raw.cards) ? raw.cards.flatMap(ruleCard) : [];
  const icons = Array.isArray(raw.icons) ? raw.icons.map(text).filter(Boolean) : [];
  // A rule whose cards did not all read would name lists it was never meant to.
  const whole = Array.isArray(raw.cards) && cards.length === raw.cards.length;
  return identifier && name && cards.length && whole ? { identifier, name, icons, cards } : null;
}

function ruleOf(value: unknown): DeckRule[] {
  const variant = variantOf(value);
  if (!variant) {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const priority = typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : 10;
  const variants = Array.isArray(raw.variants)
    ? raw.variants.map(variantOf).filter((each): each is DeckVariant => each !== null)
    : [];
  return [{ ...variant, priority, variants }];
}

/** The rules in the main site's published copy, keeping only entries that read as one. */
export function rulesFromPublished(published: unknown): DeckRule[] {
  const rules = (published as { rules?: unknown } | null)?.rules;
  return Array.isArray(rules) ? rules.flatMap(ruleOf) : [];
}
