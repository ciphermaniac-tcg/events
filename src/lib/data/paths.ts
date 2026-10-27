/** The rolling online meta report's tournament key: its folder under reports/ on R2. */
export const ONLINE = 'Online - Last 14 Days';

/** Root path for a tournament's reports. */
export function tournamentPath(name: string): string {
  return `/reports/${encodeURIComponent(name)}`;
}
