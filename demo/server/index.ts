/**
 * The demo's server: the site's own Pages Functions, run in the page against
 * a SQLite database that lives in this browser (sql.js), kept in IndexedDB
 * between visits. `window.fetch` is wrapped so the app's calls to /api and to
 * the events data bucket are answered here; nothing the demo does is sent
 * anywhere. The only requests that leave are reads of the public card and
 * archetype data the real site reads too (PUBLIC_DATA); any other request
 * for another origin is refused.
 *
 * Every tab runs its own server over one saved database, as a big screen
 * beside the console does. Each request takes the demo's lock, loads what
 * another tab saved since this one last looked, and saves what it changed
 * before letting go, so every tab answers from the same event.
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import schema from '../../config/d1/tournaments.sql?raw';
import type { TournamentEnv } from '../../functions/lib/auth/env';
import { demoBucket, type DemoBucket } from './bucket';
import { browserD1 } from './d1';
import { route } from './router';
import { alone, forget, loadSaved, save, savedVersion } from './store';
import { seed, stayingSignedIn } from './seed';
import { cookieHeader } from './cookies';
import { closedAnswer } from './closed';

/** Where the demo build reads published event pages from (VITE_EVENTS_DATA_ORIGIN). */
export const DATA_PATH = '/demo-data';

const realFetch = window.fetch.bind(window);

/** The public, read-only data the site reads: card and archetype reports, and deck sprites. */
const PUBLIC_DATA = new Set(['https://r2.ciphermaniac.com', 'https://r2.limitlesstcg.net']);

function refused(url: URL): Promise<Response> {
  return Promise.reject(new TypeError(`The demo sends nothing to ${url.origin}`));
}

/** Set once a reset begins, so nothing saves the old demo back. */
let resetting = false;

/** Whether anything changed since the last save. */
let dirty = false;

let SQL: SqlJsStatic;
let db: Database;
/**
 * The saved version this tab's database is, "<demo> <save>": which demo it
 * is, new on each Reset, and which save of it. Null while nothing is shared
 * (storage closed to the page).
 */
let version: string | null = null;

/** The demo a version belongs to; empty for a database saved before versions were kept. */
const demoOf = (saved: string): string => saved.split(' ')[0] ?? '';

/** Saves the database if a request changed it, before that request's answer is handed back. */
async function saveIfChanged(): Promise<void> {
  if (dirty && !resetting) {
    dirty = false;
    const next = `${demoOf(version ?? '') || crypto.randomUUID()} ${crypto.randomUUID()}`;
    version = (await save(db.export(), next)) ? next : null;
  }
}

/**
 * Leaves for the home page, as the tab that reset the demo does: the event
 * this tab showed is gone. The request waits on the page going rather than
 * answer from the old demo.
 */
async function startOver(): Promise<void> {
  resetting = true;
  location.assign('/');
  await new Promise<never>(() => {
    // Never settles: the page goes before the request would be answered.
  });
}

/**
 * Takes up what another tab saved since this one last looked. Once another
 * tab has reset the demo, this one starts over too.
 */
async function catchUp(): Promise<void> {
  if (version === null || resetting) {
    return;
  }
  const saved = await savedVersion();
  if (saved === version) {
    return;
  }
  const loaded = saved !== null && demoOf(saved) === demoOf(version) ? await loadSaved() : null;
  if (!loaded) {
    await startOver();
    return;
  }
  db.close();
  ({ version } = loaded);
  db = new SQL.Database(loaded.bytes);
}

/** The database as it was left, or a new one with the sample event in it. */
async function openDatabase(): Promise<boolean> {
  SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadSaved();
  if (saved) {
    db = new SQL.Database(saved.bytes);
    ({ version } = saved);
    return false;
  }
  db = new SQL.Database();
  db.exec(schema);
  return true;
}

/**
 * `request` as a browser would deliver it to a server: with its Origin and
 * the cookies kept for this site. A page may not set either header on a
 * Request it makes, so the functions see them through a stand-in.
 */
function delivered(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set('Origin', location.origin);
  const cookies = cookieHeader();
  if (cookies) {
    headers.set('Cookie', cookies);
  }
  return new Proxy(request, {
    get: (target, property) => {
      if (property === 'headers') {
        return headers;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
}

async function answer(request: Request, env: TournamentEnv): Promise<Response> {
  stayingSignedIn(db);
  return route(delivered(request), env);
}

function dataResponse(bucket: DemoBucket, path: string): Response {
  const body = bucket.read(path.slice(DATA_PATH.length + 1));
  return body === null
    ? new Response(null, { status: 404 })
    : new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

/** A call to /api, answered once this tab is caught up, and saved before the lock is let go. */
function apiResponse(request: Request, env: TournamentEnv): Promise<Response> {
  const url = new URL(request.url);
  const closed = closedAnswer(request.method, url.pathname);
  if (closed) {
    return Promise.resolve(closed);
  }
  return alone(async () => {
    await catchUp();
    const response = await answer(request, env);
    await saveIfChanged();
    return response;
  });
}

/** Starts the server and takes over the page's fetch; resolves once the sample event is ready. */
export async function startDemoServer(): Promise<void> {
  const changed = () => {
    dirty = true;
  };
  const current = () => db;
  // Two tabs opened at once seed one sample event between them, not one each.
  const { env, bucket } = await alone(async () => {
    const fresh = await openDatabase();
    const ready = demoBucket(current, changed);
    const made: TournamentEnv = { TOURNAMENT_DB: browserD1(current, changed), EVENTS_DATA: ready };
    if (fresh) {
      await seed(made, db, answer);
    }
    // A new database, or one saved before tabs shared it, gets a version the other tabs can see.
    dirty = fresh || version === '';
    await saveIfChanged();
    return { env: made, bucket: ready };
  });

  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin) {
      const reading = request.method === 'GET' || request.method === 'HEAD';
      return reading && PUBLIC_DATA.has(url.origin) ? realFetch(request) : refused(url);
    }
    if (url.pathname.startsWith('/api/')) {
      return apiResponse(request, env);
    }
    if (url.pathname.startsWith(`${DATA_PATH}/`)) {
      return alone(async () => {
        await catchUp();
        return dataResponse(bucket, url.pathname);
      });
    }
    return realFetch(request);
  };
}

/** Throws the demo's data away; the next load starts the sample event over, here and in every other tab. */
export async function resetDemo(): Promise<void> {
  resetting = true;
  await alone(forget);
  // What the site remembers of the old demo goes too (its events, lists it was sent), all but the light or dark choice.
  try {
    sessionStorage.clear();
    for (const key of Object.keys(localStorage)) {
      if (key !== 'cm:mode') {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // No storage: nothing was remembered.
  }
  location.assign('/');
}
