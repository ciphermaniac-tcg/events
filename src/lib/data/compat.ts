import type { ArchetypeIndexEntry } from '../../types';

/**
 * Archetype index files mix percent scales: indexes ingested before commit
 * 3939e71 store 0–100, newer ones store a 0–1 fraction. A per-value guess
 * (≤ 1 ⇒ fraction) misreads sub-1% archetypes in old files as ~90% shares
 * (e.g. Birmingham's 0.90% Sharpedo Toxtricity rendering as 89.7%), so decide
 * the scale once per file: any value above 1 means the file is already 0–100.
 */
export function normalizeIndexPercentScale(list: ArchetypeIndexEntry[]): ArchetypeIndexEntry[] {
  let max = 0;
  for (const entry of list) {
    if (typeof entry.percent === 'number' && entry.percent > max) {
      max = entry.percent;
    }
  }
  if (max === 0 || max > 1) {
    return list;
  }
  return list.map(entry => (typeof entry.percent === 'number' ? { ...entry, percent: entry.percent * 100 } : entry));
}
