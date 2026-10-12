import { ONLINE_META_NAME } from '../constants';

/** The rolling online meta report's tournament key. */
export const ONLINE = ONLINE_META_NAME;

/**
 * Sentinel "tournament" key used to point the standard data fetchers at a
 * pre-rotation snapshot. Format: `snapshot:YYYY-MM-DD`. Pages that want to
 * render rotated content pass this through `fetchMaster`/`fetchArchetype`/etc.
 * exactly as they would a normal tournament key, and {@link tournamentPath}
 * rewrites the R2 path to `/reports/Snapshots/{date}/...`.
 */
const SNAPSHOT_SOURCE_PREFIX = 'snapshot:';

export function isSnapshotSource(source: string): boolean {
  return source.startsWith(SNAPSHOT_SOURCE_PREFIX);
}

/** Root path for a tournament's reports, snapshot sentinels included. */
export function tournamentPath(name: string): string {
  if (isSnapshotSource(name)) {
    const date = name.slice(SNAPSHOT_SOURCE_PREFIX.length);
    return `/reports/Snapshots/${encodeURIComponent(date)}`;
  }
  return `/reports/${encodeURIComponent(name)}`;
}
