/**
 * Turning the site's English into the language being shown.
 *
 * A catalog is keyed by the English itself, so code reads as English and a
 * string missing from a catalog falls back to it word for word. Placeholders
 * are `{name}`, filled from the values passed beside the key; a translation
 * may move them anywhere.
 *
 * The language is settled once, before the first render (see lib/i18n), and a
 * switch reloads the page, so nothing here is reactive: `t` is a lookup.
 * Calling it at module scope would run before the catalog arrives — keep it
 * inside components and functions, and mark module-level English with `msg`
 * so the catalog check still finds it.
 * @module lib/i18n/translate
 */

import type { JSX } from 'solid-js';
import { type Locale, SOURCE_LOCALE } from './locales';

/** A countable phrase, one form per plural category the language uses. `other` is required. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type Catalog = Record<string, string | PluralForms>;

type Values = Record<string, string | number>;

let current: Locale = SOURCE_LOCALE;
let catalog: Catalog = {};
let plurals = new Intl.PluralRules(SOURCE_LOCALE);

export function setTranslations(locale: Locale, next: Catalog): void {
  current = locale;
  catalog = next;
  patterns = null;
  plurals = new Intl.PluralRules(locale);
}

/** The language being shown. */
export function locale(): Locale {
  return current;
}

export { msg } from '../../../shared/i18n';

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(text: string, values?: Values): string {
  if (!values) {
    return text;
  }
  return text.replace(PLACEHOLDER, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** The text for an English string in the language shown, its `{placeholders}` filled. */
export function t(english: string, values?: Values): string {
  const entry = catalog[english];
  return fill(typeof entry === 'string' ? entry : english, values);
}

/** What joins English to its context in a catalog key: "Off ‖ league night". Never in English copy. */
export const CONTEXT_MARK = ' ‖ ';

let patterns: { key: string; names: string[]; pattern: RegExp }[] | null = null;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The catalog's keys with values in them, as patterns that match the filled English. */
function messagePatterns() {
  patterns ??= Object.keys(catalog)
    .filter(key => key.includes('{'))
    .map(key => {
      const names = [...key.matchAll(PLACEHOLDER)].map(match => match[1]);
      const source = key.split(PLACEHOLDER).map((part, index) => (index % 2 ? '(.+?)' : escape(part)));
      return { key, names, pattern: new RegExp(`^${source.join('')}$`) };
    });
  return patterns;
}

/**
 * A message that arrived as English, the API's errors among them, in the
 * language shown. One the API filled in (see `msgf`) is matched back to its
 * key, and its values, a division's name say, are translated in turn.
 */
export function translateMessage(english: string): string {
  if (Object.hasOwn(catalog, english)) {
    return t(english);
  }
  for (const { key, names, pattern } of messagePatterns()) {
    const found = pattern.exec(english);
    if (found) {
      return t(key, Object.fromEntries(names.map((name, index) => [name, t(found[index + 1])])));
    }
  }
  return english;
}

/**
 * English that reads one way here and another elsewhere: `tc('league night', 'Off')`.
 * English shows the English; a catalog keys it as "Off ‖ league night", so
 * each sense gets its own translation.
 */
export function tc(context: string, english: string, values?: Values): string {
  const entry = catalog[`${english}${CONTEXT_MARK}${context}`];
  return fill(typeof entry === 'string' ? entry : english, values);
}

/**
 * A phrase about a count: `tn(3, '{n} player', '{n} players')`. The count is
 * `{n}`. The catalog keys it by the plural English and gives the forms the
 * language needs, chosen by the language's own plural rules.
 */
export function tn(n: number, one: string, other: string, values?: Values): string {
  const entry = catalog[other];
  const filled = { n, ...values };
  if (entry === undefined || typeof entry === 'string') {
    return fill(n === 1 ? one : other, filled);
  }
  return fill(entry[plurals.select(n)] ?? entry.other, filled);
}

/**
 * A sentence with markup inside it: `tx('Read the {terms}', { terms: <A …/> })`.
 * Each `{name}` becomes the node given for it, wherever the language puts it.
 */
export function tx(english: string, nodes: Record<string, JSX.Element>): JSX.Element[] {
  const parts = t(english).split(PLACEHOLDER);
  return parts.map((part, index) => (index % 2 === 1 && part in nodes ? nodes[part] : part));
}

const ORDINALS: Record<Locale, (n: number) => string> = {
  en: n => {
    const teen = n % 100;
    return teen >= 11 && teen <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  },
  es: () => '.º',
  fr: n => (n === 1 ? 'er' : 'e'),
  de: () => '.'
};

/** The ordinal ending for a placement in the language shown: "st" (1st), ".º" (1.º), "er" (1er), "." (1.). */
export function ordinalSuffix(n: number): string {
  return ORDINALS[current](Math.abs(Math.trunc(n)));
}
