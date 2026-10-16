/**
 * Which languages the site speaks, and which one a visitor gets.
 *
 * English is the site's own language: every string is written in it, every
 * key in a catalog is the English text, and anything a catalog lacks shows in
 * English. Another language is a catalog in src/locales/ plus a row here.
 *
 * A row marked `ready` is offered: a browser that asks for it gets it, and a
 * browser that lists it at all is shown a link to it. A row not yet ready is
 * reachable only through `?lang=`, so a catalog can be built and checked in
 * place before anyone is sent to it.
 * @module lib/i18n/locales
 */

export const LOCALES = {
  en: { name: 'English', ready: true },
  es: { name: 'Español', ready: true },
  fr: { name: 'Français', ready: true },
  de: { name: 'Deutsch', ready: true }
} as const satisfies Record<string, { name: string; ready: boolean }>;

export type Locale = keyof typeof LOCALES;

export const SOURCE_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(LOCALES, value);
}

/** The site's language for a BCP 47 tag ("es-MX" is es), or null when it has none. */
export function localeOf(tag: string): Locale | null {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

const readyLocale = (tag: string): Locale | null => {
  const locale = localeOf(tag);
  return locale && LOCALES[locale].ready ? locale : null;
};

export interface LocaleSignals {
  /** `?lang=` on the address: a link or a translator naming a language outright. */
  query: string | null;
  /** The language picked before, from the footer. */
  stored: string | null;
  /** The browser's languages, most wanted first (`navigator.languages`). */
  languages: readonly string[];
}

/**
 * The language to show. A named one wins, then a remembered one; otherwise
 * the first of the browser's languages the site speaks, in the browser's own
 * order — so a visitor whose browser puts Spanish first reads Spanish, and one
 * who lists English before it reads English.
 */
export function pickLocale(signals: LocaleSignals): Locale {
  for (const named of [signals.query, signals.stored]) {
    if (isLocale(named)) {
      return named;
    }
  }
  for (const tag of signals.languages) {
    const locale = readyLocale(tag);
    if (locale) {
      return locale;
    }
  }
  return SOURCE_LOCALE;
}

/**
 * The other language worth a footer link, or null for none. Reading another
 * language, English is offered back. Reading English, a ready language the
 * browser also lists is offered — someone bilingual finds it, and anyone else
 * never sees a switcher at all.
 */
export function offeredLocale(current: Locale, languages: readonly string[]): Locale | null {
  if (current !== SOURCE_LOCALE) {
    return SOURCE_LOCALE;
  }
  for (const tag of languages) {
    const locale = readyLocale(tag);
    if (locale && locale !== SOURCE_LOCALE) {
      return locale;
    }
  }
  return null;
}

/**
 * The tag dates and numbers are formatted in: the browser's own variant of
 * the language shown ("es-MX", "en-GB") when it lists one, else the bare
 * language — never a language the page is not written in.
 */
export function formatTag(current: Locale, languages: readonly string[]): string {
  return languages.find(tag => localeOf(tag) === current) ?? current;
}

/** Where distances are still counted in feet. */
const FEET_REGIONS = new Set(['US', 'LR', 'MM']);

/**
 * Whether a reader counts distances in feet: one whose language tag, filled
 * out to its likeliest region ("en" is en-US, "es" is es-ES), is in a country
 * that does. Everyone else counts in metres.
 */
export function countsFeet(tag: string): boolean {
  try {
    return FEET_REGIONS.has(new Intl.Locale(tag).maximize().region ?? '');
  } catch {
    return true;
  }
}
