/**
 * Normalizes an archetype name/label to the key form used by the icon override
 * map. Mirrors `normalize_deck_label` in download-tournament.py so the same key
 * matches both archetype `label`/`name` and trends `series.name` (the base slug,
 * e.g. "Dragapult Dusknoir" → "dragapult_dusknoir").
 */
export function normalizeArchetypeKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export interface WinRateAggregate {
  wins: number;
  losses: number;
  ties: number;
  /** Total recorded games (includes ties and double losses in the denominator). */
  games: number;
  /** 0..100 valuing a tie at 1/3, or null when there are no games. */
  winRate: number | null;
}
