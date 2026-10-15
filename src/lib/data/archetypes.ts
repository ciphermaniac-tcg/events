/**
 * Archetype index, per-archetype reports, and icon resolution.
 *
 * Archetype identity is a triple: a lowercased comparison key, a cased
 * display name, and a slug derived from the key. {@link normalizeArchetypeKey}
 * is the comparison key — every lookup that could otherwise split one archetype
 * across casing or punctuation goes through it.
 * @module src/lib/data/archetypes
 */

import { normalizeArchetypeKey } from '../../../shared/data/archetypes/winRate';
export { normalizeArchetypeKey } from '../../../shared/data/archetypes/winRate';

import { dataClient } from './client';
import { normalizeIndexPercentScale } from './compat';
import { ONLINE, tournamentPath } from './paths';
import { createSignal } from 'solid-js';
import type { ArchetypeIndexEntry } from '../../types';

const { fetchJson } = dataClient;

export async function fetchArchetypes(tournament: string = ONLINE): Promise<ArchetypeIndexEntry[]> {
  const list = await fetchJson<ArchetypeIndexEntry[]>(`${tournamentPath(tournament)}/archetypes/index.json`);
  return normalizeIndexPercentScale(list);
}

const [archetypeIconMap, setArchetypeIconMap] = createSignal(new Map<string, string[]>());
const [iconMapSettled, setIconMapSettled] = createSignal(false);
let iconMapAsked = false;

function parseIconMap(value: unknown): Map<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid archetype icon map');
  }
  const map = new Map<string, string[]>();
  for (const [label, slugs] of Object.entries(value)) {
    if (
      !Array.isArray(slugs) ||
      !slugs.every((slug: unknown) => typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug))
    ) {
      throw new Error(`Invalid archetype icons for ${label}`);
    }
    map.set(normalizeArchetypeKey(label), slugs as string[]);
  }
  return map;
}

/** Load mutable metadata from the same R2 origin as tournament reports. */
export async function loadArchetypeIconMap(
  fetchIcons: () => Promise<unknown> = () => fetchJson<unknown>('/assets/archetype-icons.json')
): Promise<void> {
  iconMapAsked = true;
  try {
    setArchetypeIconMap(parseIconMap(await fetchIcons()));
  } finally {
    setIconMapSettled(true);
  }
}

/**
 * Whether the icon map has answered, read or failed; reactive. The first ask
 * loads it, so a page that draws no deck never reads it.
 */
export function archetypeIconMapSettled(): boolean {
  if (!iconMapAsked) {
    loadArchetypeIconMap().catch(error => console.warn(error));
  }
  return iconMapSettled();
}

/** Every archetype label the icon map names; far more than any one tournament's index. */
export async function fetchArchetypeLabels(): Promise<string[]> {
  const value = await fetchJson<unknown>('/assets/archetype-icons.json');
  return value && typeof value === 'object' ? Object.keys(value) : [];
}

/** The archetype → Pokémon icon-slug map, keyed by normalized archetype name. */
export function getArchetypeIconMap(): Map<string, string[]> {
  return archetypeIconMap();
}

/**
 * Resolves an archetype's icon slugs: prefer the entry's embedded `icons` (from
 * the tournament index), else fall back to the override map by normalized
 * label/name so icons appear retroactively on tournaments that predate the field.
 */
export function resolveArchetypeIcons(
  identifiers: { name?: string | null; label?: string | null; icons?: string[] },
  map?: Map<string, string[]> | null
): string[] {
  if (identifiers.icons && identifiers.icons.length > 0) {
    return identifiers.icons;
  }
  if (!map) {
    return [];
  }
  return map.get(normalizeArchetypeKey(identifiers.label)) ?? map.get(normalizeArchetypeKey(identifiers.name)) ?? [];
}

// Backwards-compatible alias (always online meta)
export const fetchOnlineArchetypes = (): Promise<ArchetypeIndexEntry[]> => fetchArchetypes(ONLINE);

/** One archetype's usage of a card, from the precomputed `cardUsage.json` index. */
