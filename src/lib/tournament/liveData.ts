/** Freshness records successful reads, including unchanged responses, separately from event mutations. */
export type LiveFailure = 'authorization' | 'network' | 'unavailable';

export interface LiveData {
  checkedAt: number | null;
  failure: LiveFailure | null;
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
  const waited = data.checkedAt === null ? data.failure !== null : now - data.checkedAt >= STALE_AFTER_MS;
  return waited || data.failure === 'authorization';
}

export const LIVE_FAILURE_LABELS: Record<LiveFailure, string> = {
  authorization: 'Access expired',
  network: 'Connection unavailable',
  unavailable: 'Updates unavailable'
};
