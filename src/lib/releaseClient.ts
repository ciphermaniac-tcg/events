/**
 * Release-aware data path resolution for the browser.
 *
 * The main site embeds its data release at build time. This site deploys on its
 * own schedule, so it asks the main site's bucket which release is current
 * (`current.json`, never cached) and resolves against that manifest, once per
 * document. If the pointer or manifest can't be read, legacy `reports/…` paths
 * pass through unchanged.
 */

import { createReleaseResolver, type ReleaseResolver } from '../../shared/releaseManifest';
import type { ReleaseScope } from '../../shared/data/build/release';
import { R2_ORIGIN } from './constants';

interface ReleasePointer {
  manifest?: unknown;
}

async function fetchJsonOrThrow(fetchImpl: typeof globalThis.fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, { mode: 'cors', ...init });
  if (!response.ok) {
    void response.body?.cancel();
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

/**
 * Read the main site's current release and build a resolver over it.
 * @param fetchImpl - Transport
 * @param origin - The main site's data origin
 * @returns The resolver; a legacy one when the release can't be read
 */
export async function loadCurrentResolver(
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args),
  origin: string = R2_ORIGIN
): Promise<ReleaseResolver> {
  try {
    const pointer = (await fetchJsonOrThrow(fetchImpl, `${origin}/current.json`, {
      cache: 'no-store'
    })) as ReleasePointer;
    if (typeof pointer.manifest !== 'string' || !pointer.manifest.startsWith('/releases/v1/')) {
      throw new Error('Invalid release pointer');
    }
    return createReleaseResolver(await fetchJsonOrThrow(fetchImpl, `${origin}${pointer.manifest}`));
  } catch (error) {
    console.warn(error);
    return createReleaseResolver(null);
  }
}

let current: Promise<ReleaseResolver> | null = null;
let releaseAware = false;

// A release that couldn't be read is not remembered: the next data path asks again.
function resolver(): Promise<ReleaseResolver> {
  current ??= loadCurrentResolver().then(loaded => {
    releaseAware = loaded.isReleaseAware;
    if (!loaded.isReleaseAware) {
      current = null;
    }
    return loaded;
  });
  return current;
}

const ONLINE_PREFIX = 'reports/Online - Last 14 Days/';
const TRENDS_PREFIX = 'reports/Trends - Last 30 Days/';
const SNAPSHOTS_PREFIX = 'reports/Snapshots/';
const PLAYERS_PREFIX = 'players/';

/** Classify a legacy report path to a scope + scope-relative path, or null. */
function classify(path: string): { scope: ReleaseScope; rel: string } | null {
  const p = path.replace(/^\/+/, '');
  if (p.startsWith('assets/')) {
    return { scope: 'assets', rel: p.slice('assets/'.length) };
  }
  if (p.startsWith(ONLINE_PREFIX)) {
    return { scope: 'online', rel: p.slice(ONLINE_PREFIX.length) };
  }
  if (p.startsWith(TRENDS_PREFIX)) {
    return { scope: 'trends', rel: p.slice(TRENDS_PREFIX.length) };
  }
  if (p.startsWith(SNAPSHOTS_PREFIX)) {
    return { scope: 'snapshots', rel: p.slice(SNAPSHOTS_PREFIX.length) };
  }
  if (p.startsWith(PLAYERS_PREFIX)) {
    return { scope: 'players', rel: p.slice(PLAYERS_PREFIX.length) };
  }
  if (p === 'reports/tournaments.json') {
    return { scope: 'catalogs', rel: 'tournaments.json' };
  }
  if (p.startsWith('reports/price-history/')) {
    return { scope: 'prices', rel: p.slice('reports/'.length) };
  }
  if (p === 'reports/prices.json' || p === 'reports/prices-history.json' || p === 'reports/price-movers.json') {
    return { scope: 'prices', rel: p.slice('reports/'.length) };
  }
  if (p === 'reports/majors-trends.json') {
    return { scope: 'trends', rel: 'majors-trends.json' };
  }
  return null;
}

/**
 * Resolve a report path. Local builds without a manifest pass paths through;
 * release builds resolve every recognized data path immutably and reject paths
 * absent from that release.
 * @param path - The legacy report path (e.g. "/reports/Online - Last 14 Days/master.json")
 * @returns The path to fetch (unchanged in legacy mode, or a `/releases/v1/…` path)
 */
export async function resolveDataPath(path: string): Promise<string> {
  return resolvePathWith(await resolver(), path);
}

/**
 * Pure core of {@link resolveDataPath}, parameterized on the resolver so the
 * release-aware rewriting is unit-testable with an injected manifest.
 * @param withResolver - The release resolver to use
 * @param path - The legacy report path
 * @returns The resolved path (unchanged in legacy mode)
 */
export function resolvePathWith(withResolver: ReleaseResolver, path: string): string {
  if (path === '/upcoming.json' || !withResolver.isReleaseAware) {
    return path;
  }
  const normalized = path.replace(
    /^(\/*reports\/)([^/]+)/,
    (_match, prefix: string, folder: string) => `${prefix}${decodeURIComponent(folder)}`
  );
  const classified = classify(normalized);
  if (classified) {
    const resolved = withResolver.scopePath(classified.scope, classified.rel);
    return resolved.startsWith('/') ? resolved : `/${resolved}`;
  }
  // Event-folder path: /reports/{YYYY-MM-DD, Name}/{rel}. Resolve via the
  // release's event map, keyed by the folder name the UI already uses.
  const event = classifyEvent(normalized);
  if (event) {
    const resolved = withResolver.eventPath(event.folder, event.rel);
    if (resolved) {
      return resolved.startsWith('/') ? resolved : `/${resolved}`;
    }
  }
  throw new Error(`Data path is not present in release ${withResolver.releaseId}: ${path}`);
}

/** True when a resolved path targets an immutable release body. */
export function isReleasePath(path: string): boolean {
  return path.startsWith('/releases/v1/');
}

/**
 * Decide how to handle a 404 on a resolved report path. A missing IMMUTABLE
 * release body is treated as corruption: recover with exactly ONE controlled
 * reload (to adopt the newer current release) — never fall back to a legacy
 * generation within the same document. A 404 on a legacy path, or a second
 * miss after we already reloaded, is a normal miss.
 * @param resolvedPath - The path that 404'd (post-resolution)
 * @param releaseAware - Whether a release manifest is driving resolution
 * @param alreadyReloaded - Whether this document already did its one recovery reload
 * @returns 'reload' to perform the single recovery reload, else 'passthrough'
 */
export function planMissingBodyRecovery(
  resolvedPath: string,
  releaseAware: boolean,
  alreadyReloaded: boolean
): 'reload' | 'passthrough' {
  return releaseAware && isReleasePath(resolvedPath) && !alreadyReloaded ? 'reload' : 'passthrough';
}

const RELOAD_FLAG = 'ciphermaniac.releaseRecoveryReloaded';

/**
 * Browser side of {@link planMissingBodyRecovery}: perform the one controlled
 * recovery reload for a missing release body, guarded by session storage so it
 * can never loop. No-op outside the browser. Returns true when it initiated a
 * reload (the caller should stop, a navigation is underway).
 * @param resolvedPath - The 404'd resolved path
 * @returns Whether a recovery reload was initiated
 */
export function recoverFromMissingReleaseBody(resolvedPath: string): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }
  const already = sessionStorage.getItem(RELOAD_FLAG) === '1';
  if (planMissingBodyRecovery(resolvedPath, releaseAware, already) !== 'reload') {
    return false;
  }
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
  return true;
}

/** Classify a dated event-folder report path to (folder, folder-relative path). */
function classifyEvent(path: string): { folder: string; rel: string } | null {
  const p = path.replace(/^\/+/, '');
  if (!p.startsWith('reports/')) {
    return null;
  }
  const rest = p.slice('reports/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) {
    return null;
  }
  const folder = rest.slice(0, slash);
  // Only dated event folders (exclude Online/Trends/Snapshots, handled above).
  if (!/^\d{4}-\d{2}-\d{2},/.test(folder)) {
    return null;
  }
  return { folder, rel: rest.slice(slash + 1) };
}
