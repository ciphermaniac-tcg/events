/**
 * The demo's server: the site's own Pages Functions, run in the page against
 * a SQLite database that lives in this browser (sql.js), kept in IndexedDB
 * between visits. `window.fetch` is wrapped so the app's calls to /api and to
 * the events data bucket are answered here; nothing the demo does is sent
 * anywhere. The only requests that leave are reads of the public card and
 * archetype data the real site reads too (PUBLIC_DATA); any other request
 * for another origin is refused.
 */

import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import schema from '../../config/d1/tournaments.sql?raw';
import type { TournamentEnv } from '../../functions/lib/auth/env';
import { demoBucket, type DemoBucket } from './bucket';
import { browserD1 } from './d1';
import { route } from './router';
import { forget, loadSaved, save } from './store';
import { seed, stayingSignedIn } from './seed';
import { cookieHeader } from './cookies';

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

/** Saves the database if a request changed it, before that request's answer is handed back. */
async function saveIfChanged(db: Database): Promise<void> {
  if (dirty && !resetting) {
    dirty = false;
    await save(db.export());
  }
}

/** The database as it was left, or a new one with the sample event in it. */
async function openDatabase(): Promise<{ db: Database; fresh: boolean }> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadSaved();
  if (saved) {
    return { db: new SQL.Database(saved), fresh: false };
  }
  const db = new SQL.Database();
  db.exec(schema);
  return { db, fresh: true };
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

async function answer(request: Request, env: TournamentEnv, db?: Database): Promise<Response> {
  if (db) {
    stayingSignedIn(db);
  }
  return route(delivered(request), env);
}

function dataResponse(bucket: DemoBucket, path: string): Response {
  const body = bucket.read(path.slice(DATA_PATH.length + 1));
  return body === null
    ? new Response(null, { status: 404 })
    : new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

/** Starts the server and takes over the page's fetch; resolves once the sample event is ready. */
export async function startDemoServer(): Promise<void> {
  const { db, fresh } = await openDatabase();
  const changed = () => {
    dirty = true;
  };
  const bucket = demoBucket(db, changed);
  const env: TournamentEnv = { TOURNAMENT_DB: browserD1(db, changed), EVENTS_DATA: bucket };

  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin) {
      const reading = request.method === 'GET' || request.method === 'HEAD';
      return reading && PUBLIC_DATA.has(url.origin) ? realFetch(request) : refused(url);
    }
    if (url.pathname.startsWith('/api/')) {
      const response = await answer(request, env, db);
      await saveIfChanged(db);
      return response;
    }
    if (url.pathname.startsWith(`${DATA_PATH}/`)) {
      return dataResponse(bucket, url.pathname);
    }
    return realFetch(request);
  };

  if (fresh) {
    await seed(env, db, answer);
    await saveIfChanged(db);
  }
}

/** Throws the demo's data away; the next load starts the sample event over. */
export async function resetDemo(): Promise<void> {
  resetting = true;
  await forget();
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
