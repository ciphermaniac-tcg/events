/**
 * The site's languages, in the browser. `initLocale` settles the language
 * before the first render (main.tsx) and loads its catalog; English needs no
 * catalog and costs no request. A catalog is a hashed JSON file fetched only
 * by the visitors who read it, so English pages carry none of it.
 *
 * Choosing a language from the footer stores the choice and reloads: every
 * string is read once, at render, which keeps `t` a plain lookup.
 * @module lib/i18n
 */

import {
  countsFeet,
  formatTag,
  type Locale,
  localeOf,
  LOCALES,
  offeredLocale,
  pickLocale,
  SOURCE_LOCALE
} from './locales';
import { type Catalog, locale, setTranslations } from './translate';

export { locale, msg, t, tc, tn, translateMessage, tx } from './translate';

const STORAGE_KEY = 'cm:lang';
const QUERY_KEY = 'lang';
/** How long a catalog may take before the page is shown in English instead. */
const CATALOG_TIMEOUT_MS = 4000;

// Vite turns the glob into each catalog's hashed URL. Node, running the unit
// tests, has neither: there the site speaks English alone.
const CATALOGS: Record<string, string> = import.meta.env
  ? import.meta.glob<string>('../../locales/*.json', { query: '?url', import: 'default', eager: true })
  : {};

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(target: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, target);
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
}

const browserLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages);

async function fetchCatalog(target: Locale, catalogs: Record<string, string>): Promise<Catalog | null> {
  const url = catalogs[`../../locales/${target}.json`];
  if (!url) {
    return null;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    return response.ok ? ((await response.json()) as Catalog) : null;
  } catch {
    return null;
  }
}

/**
 * Settles the language and loads its catalog. Call once, and render after it
 * resolves. `catalogs` is each catalog's URL by path, as Vite's glob names them.
 */
export async function initLocale(catalogs = CATALOGS): Promise<void> {
  const query = new URLSearchParams(location.search).get(QUERY_KEY);
  const named = localeOf(query ?? '');
  if (named) {
    remember(named);
  }
  const target = pickLocale({ query: named, stored: stored(), languages: browserLanguages() });
  if (target === SOURCE_LOCALE) {
    return;
  }
  const catalog = await fetchCatalog(target, catalogs);
  if (catalog) {
    setTranslations(target, catalog);
    document.documentElement.lang = target;
  }
}

/** Shows the site in another language from now on. */
export function chooseLocale(target: Locale): void {
  remember(target);
  const url = new URL(location.href);
  url.searchParams.delete(QUERY_KEY);
  location.replace(url);
}

/** The language a footer link offers, or null when the visitor has no use for one. */
export function offeredLanguage(): { locale: Locale; name: string } | null {
  const offered = offeredLocale(locale(), browserLanguages());
  return offered ? { locale: offered, name: LOCALES[offered].name } : null;
}

/** The tag to format dates and numbers in, matching the language shown. */
export function intlLocale(): string {
  return formatTag(locale(), browserLanguages());
}

/** A time of day as the language shown writes it: "3:14 PM". */
export const timeOfDay = (at: number | string | Date): string =>
  new Date(at).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });

/** Whether the reader measures a room in feet rather than metres. */
export function measuresInFeet(): boolean {
  return countsFeet(intlLocale());
}
