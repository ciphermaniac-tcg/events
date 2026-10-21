import { msg } from '../../../shared/i18n';

/** Freshness records successful reads, including unchanged responses, separately from event mutations. */
export type LiveFailure = 'authorization' | 'network' | 'unavailable';

export interface LiveData {
  checkedAt: number | null;
  failure: LiveFailure | null;
  /** When the page last came back into view: a hidden page does not check, so it is not behind for that. */
  shownAt?: number | null;
}

export const EMPTY_LIVE_DATA: LiveData = { checkedAt: null, failure: null };
export const STALE_AFTER_MS = 25_000;

export function liveFailure(error: unknown): LiveFailure {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : 0;
  if (status === 401 || status === 403) {
    return 'authorization';
  }
  return status ? 'unavailable' : 'network';
}

/** A single missed check stays quiet; lost access, or no good check for a while, is disclosed. */
export function liveDataStale(data: LiveData, now: number): boolean {
  const since = Math.max(data.checkedAt ?? 0, data.shownAt ?? 0);
  const waited = data.checkedAt === null ? data.failure !== null : now - since >= STALE_AFTER_MS;
  return waited || data.failure === 'authorization';
}

/** A stale page: `since` is when it fell behind, where its clocks stop, and `checkedAt` when it last heard from the event. */
export interface Stale {
  since: number;
  checkedAt: number;
}

/**
 * Where the page stands while what it has is stale (see liveDataStale); null
 * while fresh. Clocks run on local time until the page falls behind, then
 * stop there: never back at the last check, which would add time to the round.
 */
export function staleSince(data: LiveData, now: number): Stale | null {
  if (!liveDataStale(data, now)) {
    return null;
  }
  const checkedAt = data.checkedAt ?? now;
  return { since: Math.min(now, Math.max(checkedAt, data.shownAt ?? 0) + STALE_AFTER_MS), checkedAt };
}

export const LIVE_FAILURE_LABELS: Record<LiveFailure, string> = {
  authorization: msg('Access expired'),
  network: msg('Connection unavailable'),
  unavailable: msg('Updates unavailable')
};
