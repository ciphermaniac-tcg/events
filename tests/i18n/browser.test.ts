import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { chooseLocale, initLocale, intlLocale, offeredLanguage, t } from '../../src/lib/i18n/index.ts';
import { locale, setTranslations } from '../../src/lib/i18n/translate.ts';

const CATALOGS = { '../../locales/es.json': '/assets/es-abc.json', '../../locales/fr.json': '/assets/fr-abc.json' };
const ES = { Standings: 'Clasificación' };

interface Page {
  stored: Map<string, string>;
  fetched: string[];
  replaced: string[];
  html: { lang: string };
}

const originals = new Map(
  ['location', 'localStorage', 'navigator', 'document', 'fetch'].map(name => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name)
  ])
);

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** A browser at `href` that speaks `languages`, answering catalog requests with `answer`. */
function browser(href: string, languages: string[], answer: () => Promise<Response> = async () => Response.json(ES)) {
  const page: Page = { stored: new Map(), fetched: [], replaced: [], html: { lang: 'en' } };
  const url = new URL(href);
  define('location', { href: url.href, search: url.search, replace: (to: URL) => page.replaced.push(String(to)) });
  define('localStorage', {
    getItem: (key: string) => page.stored.get(key) ?? null,
    setItem: (key: string, value: string) => page.stored.set(key, value)
  });
  define('navigator', { languages });
  define('document', { documentElement: page.html });
  define('fetch', async (request: string) => {
    page.fetched.push(request);
    return answer();
  });
  return page;
}

beforeEach(() => setTranslations('en', {}));
afterEach(() => {
  setTranslations('en', {});
  for (const [name, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('an English browser settles at once, with no request and no switch offered', async () => {
  const page = browser('https://events.test/', ['en-US', 'de']);
  await initLocale(CATALOGS);
  assert.equal(locale(), 'en');
  assert.deepEqual(page.fetched, []);
  assert.equal(page.html.lang, 'en');
  assert.equal(offeredLanguage(), null);
  assert.equal(intlLocale(), 'en-US');
});

test('a Spanish browser loads the Spanish catalog before render and is offered English back', async () => {
  const page = browser('https://events.test/', ['es-MX', 'en']);
  await initLocale(CATALOGS);
  assert.deepEqual(page.fetched, ['/assets/es-abc.json']);
  assert.equal(locale(), 'es');
  assert.equal(page.html.lang, 'es');
  assert.equal(t('Standings'), 'Clasificación');
  assert.deepEqual(offeredLanguage(), { locale: 'en', name: 'English' });
  assert.equal(intlLocale(), 'es-MX');
});

test('a bilingual English browser is offered Spanish', async () => {
  browser('https://events.test/', ['en-US', 'es-US']);
  await initLocale(CATALOGS);
  assert.equal(locale(), 'en');
  assert.deepEqual(offeredLanguage(), { locale: 'es', name: 'Español' });
});

test('?lang= names a language and remembers it', async () => {
  const page = browser('https://events.test/t/ABC?lang=es', ['en-US']);
  await initLocale(CATALOGS);
  assert.equal(locale(), 'es');
  assert.equal(page.stored.get('cm:lang'), 'es');
});

test('a catalog that fails, errors or is missing leaves the page in English', async () => {
  for (const answer of [
    async () => new Response('nope', { status: 503 }),
    async () => Promise.reject(new Error('offline'))
  ]) {
    const page = browser('https://events.test/', ['es'], answer);
    await initLocale(CATALOGS);
    assert.equal(locale(), 'en');
    assert.equal(page.html.lang, 'en');
  }
  const page = browser('https://events.test/', ['es']);
  await initLocale({});
  assert.deepEqual(page.fetched, []);
  assert.equal(locale(), 'en');
});

test('storage that refuses still lets a named language show', async () => {
  const page = browser('https://events.test/?lang=es', ['en']);
  define('localStorage', {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    }
  });
  await initLocale(CATALOGS);
  assert.equal(locale(), 'es');
  assert.equal(page.stored.size, 0);
});

test('choosing a language remembers it and reloads the same page without ?lang=', () => {
  const page = browser('https://events.test/t/ABC?tab=round&lang=es', ['en']);
  chooseLocale('en');
  assert.equal(page.stored.get('cm:lang'), 'en');
  assert.deepEqual(page.replaced, ['https://events.test/t/ABC?tab=round']);
});
