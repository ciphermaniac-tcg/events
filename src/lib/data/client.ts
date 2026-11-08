/**
 * HTTP transport for the browser data layer.
 *
 * Split out of `src/lib/data.ts` so the fetch/dedupe/cache behavior — which
 * every page depends on and which nothing could test — has a seam. The
 * dependencies that made it untestable are now parameters: `fetch`, the clock,
 * release-path resolution, and missing-release-body recovery.
 *
 * There is no DI framework here and there should not be one. {@link createDataClient}
 * is a factory over a small options bag; the module-level default instance is
 * wired to the real globals and is what the rest of the data layer uses.
 * @module src/lib/data/client
 */

import { recoverFromMissingReleaseBody, resolveDataPath } from '../releaseClient';

import { R2_ORIGIN as R2_BASE } from '../constants';

/**
 * How long a resolved response stays in the dedupe cache.
 *
 * Long enough that a navigation burst shares one download of the large shared
 * payloads (master.json, cardUsage.json, the synonym database), short enough
 * that a tab left open across the daily data update picks up fresh reports
 * within minutes.
 */
export const FETCH_TTL_MS = 5 * 60 * 1000;

export interface DataClientOptions {
  /** Transport. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Clock for cache expiry, in ms. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Legacy path → path to actually fetch. Defaults to the current release
   * resolver, which is a no-op when no release could be read.
   */
  resolvePath?: (path: string) => string | Promise<string>;
  /**
   * Handle a 404 on a resolved path. Returns true when it started a recovery
   * navigation (a missing immutable release body), in which case the request
   * never resolves.
   */
  recoverFromMissingBody?: (resolvedPath: string) => boolean;
}

export interface DataClient {
  /** Fetch JSON from R2; rejects on any non-OK response. */
  fetchJson: <T>(path: string) => Promise<T>;
  /** Number of entries currently held. For tests. */
  readonly cacheSize: number;
}

/**
 * Build a data client.
 *
 * The cache is a dedupe map first and a short TTL cache second: `expires` is
 * Infinity while a request is in flight, so concurrent callers share one
 * download, then becomes `now + ttl` once resolved. A REJECTED entry is evicted
 * immediately, so a user-triggered retry gets a real fetch rather than a cached
 * failure. Expired entries are swept on insert so multi-megabyte payloads do
 * not accumulate for the life of the session.
 * @param options - Injectable dependencies; every one has a production default
 * @returns The client
 */
export function createDataClient(options: DataClientOptions = {}): DataClient {
  const {
    fetch: fetchImpl = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
    now = Date.now,
    resolvePath = resolveDataPath,
    recoverFromMissingBody = recoverFromMissingReleaseBody
  } = options;

  const inflight = new Map<string, { promise: Promise<unknown>; expires: number }>();

  function cached(url: string): Promise<unknown> | null {
    const entry = inflight.get(url);
    if (!entry) {
      return null;
    }
    if (now() > entry.expires) {
      inflight.delete(url);
      return null;
    }
    return entry.promise;
  }

  function remember(url: string, promise: Promise<unknown>): void {
    const at = now();
    for (const [key, entry] of inflight) {
      if (at > entry.expires) {
        inflight.delete(key);
      }
    }
    const entry = { promise, expires: Infinity };
    inflight.set(url, entry);
    promise.then(
      () => {
        entry.expires = now() + FETCH_TTL_MS;
      },
      () => {
        // Only evict if this entry is still the current one — a retry may have
        // already replaced it.
        if (inflight.get(url) === entry) {
          inflight.delete(url);
        }
      }
    );
  }

  async function read<T>(url: string, resolvedPath: string): Promise<T> {
    const response = await fetchImpl(url, { mode: 'cors' });
    if (response.ok) {
      return (await response.json()) as T;
    }
    // A 404 on an IMMUTABLE release body is corruption, not a miss: recover
    // with one controlled reload (adopt a newer release) rather than mixing a
    // legacy generation into this document.
    if (response.status === 404 && recoverFromMissingBody(resolvedPath)) {
      return new Promise<T>(() => {}); // navigation underway; never resolves
    }
    // An unread body holds the request open, and with it the page's network idle.
    void response.body?.cancel();
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  async function fetchJson<T>(path: string): Promise<T> {
    // Release-aware resolution: rewrites scope paths to their immutable release
    // roots, or a no-op when no release could be read.
    const resolvedPath = await resolvePath(path);
    const url = `${R2_BASE}${resolvedPath}`;
    const hit = cached(url);
    if (hit) {
      return hit as Promise<T>;
    }
    const promise = read<T>(url, resolvedPath);
    remember(url, promise);
    return promise;
  }

  return {
    fetchJson,
    get cacheSize() {
      return inflight.size;
    }
  };
}

/** The application's client, wired to the real globals. */
export const dataClient = createDataClient();
