/**
 * The browser data layer's public surface: the main site's archetype data the
 * event pages read for deck pickers and icons.
 *
 * Every reader lives in a focused module under ./data. This file is the barrel
 * that keeps page imports at a single site.
 * @module src/lib/data
 */

export {
  fetchArchetypeLabels,
  fetchOnlineArchetypes,
  getArchetypeIconMap,
  normalizeArchetypeKey,
  resolveArchetypeIcons
} from './data/archetypes';
